import type { Profile } from '../types/index.js';
import { ZentaoClient } from '../api/client.js';
import { ZentaoError } from '../errors.js';
import { getCurrentProfile, getProfile, saveProfile, getProfileConfig, buildProfile } from '../config/store.js';
import { login, getEnvCredentials, verifyToken, type EnvCredentials, type LoginResult } from './login.js';

/** 已通过鉴权后的运行时上下文，供命令层发起 API 调用 */
export interface AuthContext {
    client: ZentaoClient;
    profile: Profile;
}

function normalizeServer(url: string): string {
    return url.replace(/\/+$/, '');
}

function envMatchesProfile(env: EnvCredentials, profile: Profile): boolean {
    if (!env.url || !env.account) return false;
    return profile.account === env.account
        && normalizeServer(profile.server) === normalizeServer(env.url);
}

/** 从 Profile 或匹配的环境变量中解析可用于重新登录的密码 */
function getPasswordForRelogin(profile: Profile | undefined, env: EnvCredentials): string | undefined {
    if (profile?.password) return profile.password;
    if (profile && envMatchesProfile(env, profile) && env.password) return env.password;
    return undefined;
}

async function persistAuth(
    result: LoginResult,
    account: string,
    password: string | undefined,
    oldProfile: Profile | undefined,
    clientOpts: { insecure?: boolean; timeout?: number },
): Promise<AuthContext> {
    const profile = buildProfile(
        result.server,
        account,
        result.token,
        result.serverConfig,
        result.user,
        oldProfile,
        result.apiVersion,
        password,
    );
    saveProfile(profile);
    return {
        client: new ZentaoClient(result.server, result.token, {
            ...clientOpts,
            apiVersion: result.apiVersion,
        }),
        profile,
    };
}

/**
 * 确保当前进程具备可用的禅道凭证。
 *
 * 解析顺序：
 * 1. 读取本地 `currentProfile`：校验 Token；若失效且配置中有密码（或匹配的环境变量密码），则自动重新登录
 * 2. 否则读取 `ZENTAO_*` 环境变量：优先 Token，其次账号密码登录
 * 3. 均失败时抛出 {@link ZentaoError} `E1006`
 */
export async function ensureAuth(options?: { insecure?: boolean; timeout?: number }): Promise<AuthContext> {
    const currentProfile = getCurrentProfile();
    const env = getEnvCredentials();
    const config = currentProfile ? getProfileConfig(currentProfile) : undefined;
    const clientOpts = {
        insecure: options?.insecure ?? config?.insecure,
        timeout: options?.timeout ?? config?.timeout,
    };

    if (currentProfile?.token) {
        const client = new ZentaoClient(currentProfile.server, currentProfile.token, {
            ...clientOpts,
            apiVersion: currentProfile.apiVersion ?? 'v2',
        });
        try {
            await verifyToken(client, currentProfile.account);
            currentProfile.lastUsedTime = new Date().toISOString();
            saveProfile(currentProfile);
            return { client, profile: currentProfile };
        } catch (error) {
            if (!(error instanceof ZentaoError) || error.code !== '1004') {
                throw error;
            }
            const password = getPasswordForRelogin(currentProfile, env);
            if (!password) {
                throw error;
            }
            const result = await login(currentProfile.server, currentProfile.account, password, clientOpts);
            return persistAuth(result, currentProfile.account, password, currentProfile, clientOpts);
        }
    }

    if (currentProfile) {
        const password = getPasswordForRelogin(currentProfile, env);
        if (password) {
            const result = await login(currentProfile.server, currentProfile.account, password, clientOpts);
            return persistAuth(result, currentProfile.account, password, currentProfile, clientOpts);
        }
    }

    if (env.url && env.account && (!currentProfile || envMatchesProfile(env, currentProfile))) {
        const normalizedServer = normalizeServer(env.url);
        const existingProfile = getProfile(env.account, normalizedServer);
        if (env.token) {
            const profile = buildProfile(
                env.url,
                env.account,
                env.token,
                undefined,
                undefined,
                existingProfile,
                existingProfile?.apiVersion ?? 'v2',
                existingProfile?.password,
            );
            saveProfile(profile);
            return {
                client: new ZentaoClient(env.url, env.token, {
                    ...clientOpts,
                    apiVersion: existingProfile?.apiVersion ?? 'v2',
                }),
                profile,
            };
        }

        if (env.password) {
            const result = await login(env.url, env.account, env.password, clientOpts);
            return persistAuth(result, env.account, env.password, existingProfile, clientOpts);
        }
    }

    throw new ZentaoError('E1006');
}

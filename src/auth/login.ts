import { ZentaoClient } from '../api/client.js';
import type { ApiVersion } from '../api/version.js';
import { buildApiBaseUrl, expandServerCandidates } from '../api/version.js';
import type { LoginResponse, ApiResponse, ServerConfig } from '../types/index.js';
import { ZentaoError } from '../errors.js';

/** 密码登录成功后的结果 */
export interface LoginResult {
    token: string;
    user?: Record<string, unknown>;
    serverConfig?: ServerConfig;
    /** 实际连通的站点根地址（可能自动补全 `/zentao` 子路径） */
    server: string;
    apiVersion: ApiVersion;
}

/** 从环境变量读取的凭证片段（任一字段可能缺失） */
export interface EnvCredentials {
    url?: string;
    account?: string;
    password?: string;
    token?: string;
}

class LoginAttemptError extends Error {}

/**
 * 使用账号密码登录禅道，自动探测站点路径与 API 版本。
 * - 站点路径：依次尝试用户输入地址及 `/zentao` 子路径
 * - API 版本：优先 v2 `/users/login`，失败时回退 v1 `/tokens`（适用于禅道 18.0 开源版）
 */
export async function login(
    serverUrl: string,
    account: string,
    password: string,
    options?: { insecure?: boolean; timeout?: number },
): Promise<LoginResult> {
    const candidates = expandServerCandidates(serverUrl);
    let lastError: unknown;

    for (const candidate of candidates) {
        try {
            return await loginAt(candidate, account, password, options);
        } catch (error) {
            if (error instanceof ZentaoError && error.code === 'E1003') {
                throw error;
            }
            lastError = error;
        }
    }

    if (lastError instanceof ZentaoError) {
        throw lastError;
    }
    throw new ZentaoError('E1002', { url: serverUrl.replace(/\/+$/, '') });
}

async function loginAt(
    serverUrl: string,
    account: string,
    password: string,
    options?: { insecure?: boolean; timeout?: number },
): Promise<LoginResult> {
    const url = serverUrl.replace(/\/+$/, '');

    if (options?.insecure) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    try {
        let token: string;
        let apiVersion: ApiVersion;

        try {
            ({ token, apiVersion } = await loginWithApiVersion(url, 'v2', account, password, options));
        } catch (error) {
            if (error instanceof ZentaoError && error.code === 'E1003') {
                throw error;
            }
            ({ token, apiVersion } = await loginWithApiVersion(url, 'v1', account, password, options));
        }

        const client = new ZentaoClient(url, token, { ...options, apiVersion });
        let user: Record<string, unknown> | undefined;
        let serverConfig: ServerConfig | undefined;
        try {
            ({ serverConfig, user } = await verifyToken(client, account));
        } catch {
            // Token valid but couldn't fetch user details - not fatal
        }

        return { token, user, serverConfig, server: url, apiVersion };
    } catch (error) {
        if (error instanceof ZentaoError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ZentaoError('E5001');
        }
        const msg = (error as Error).message ?? '';
        if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
            throw new ZentaoError('E1002', { url });
        }
        throw error;
    } finally {
        if (options?.insecure) {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
    }
}

async function loginWithApiVersion(
    serverUrl: string,
    apiVersion: ApiVersion,
    account: string,
    password: string,
    options?: { insecure?: boolean; timeout?: number },
): Promise<{ token: string; apiVersion: ApiVersion }> {
    const baseUrl = buildApiBaseUrl(serverUrl, apiVersion);
    const loginPath = apiVersion === 'v1' ? '/tokens' : '/users/login';
    const controller = new AbortController();
    const timeout = options?.timeout ?? 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`${baseUrl}${loginPath}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, password }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        const responseText = await response.text();
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
            throw new LoginAttemptError('invalid json');
        }

        if (apiVersion === 'v1') {
            if (response.status === 401 || response.status === 403 || data.error) {
                throw new ZentaoError('E1003');
            }
            if (!response.ok || typeof data.token !== 'string') {
                throw new LoginAttemptError('v1 login failed');
            }
            return { token: data.token, apiVersion };
        }

        if (response.status === 401 || response.status === 403) {
            throw new ZentaoError('E1003');
        }
        if (!response.ok) {
            throw new LoginAttemptError('v2 login failed');
        }

        const loginData = data as LoginResponse;
        if (loginData.status !== 'success' || !loginData.token) {
            throw new ZentaoError('E1003');
        }
        return { token: loginData.token, apiVersion };
    } catch (error) {
        clearTimeout(timer);
        if (error instanceof ZentaoError) throw error;
        if (error instanceof LoginAttemptError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ZentaoError('E5001');
        }
        throw error;
    }
}

/**
 * 拉取服务器配置与用户列表，用于验证 Token 是否可用。
 * - /server/config 失败抛 E1002（服务不可达）
 * - /users 401 由 ZentaoClient 映射为 E1004（Token 失效）
 * - /users 返回空列表也按 E1004 处理
 */
export async function verifyToken(
    client: ZentaoClient,
    account: string,
): Promise<{ serverConfig: ServerConfig; user?: Record<string, unknown> }> {
    const serverConfig = await client.getServerConfig();
    const usersResp = await client.get<ApiResponse>('/users', { browseType: 'inside', recPerPage: 100, pageID: 1 });
    const users = usersResp.users as Array<Record<string, unknown>> | undefined;
    if (!users?.length) {
        throw new ZentaoError('E1004');
    }
    const user = users.find((u) => u.account === account);
    return { serverConfig, user };
}

/** 读取 `ZENTAO_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD` / `ZENTAO_TOKEN` */
export function getEnvCredentials(): EnvCredentials {
    return {
        url: process.env.ZENTAO_URL,
        account: process.env.ZENTAO_ACCOUNT,
        password: process.env.ZENTAO_PASSWORD,
        token: process.env.ZENTAO_TOKEN,
    };
}

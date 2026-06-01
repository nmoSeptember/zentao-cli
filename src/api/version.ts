/** 禅道 REST API 版本 */
export type ApiVersion = 'v1' | 'v2';

/** 拼接 API 根路径，例如 `https://host/zentao/api.php/v1` */
export function buildApiBaseUrl(serverUrl: string, version: ApiVersion): string {
    const url = serverUrl.replace(/\/+$/, '');
    return `${url}/api.php/${version}`;
}

/**
 * 根据用户输入展开候选站点根地址。
 * 许多安装将禅道部署在 `/zentao` 子路径下。
 */
export function expandServerCandidates(serverUrl: string): string[] {
    const url = serverUrl.replace(/\/+$/, '');
    const candidates: string[] = [];
    const seen = new Set<string>();

    const add = (candidate: string) => {
        if (!seen.has(candidate)) {
            seen.add(candidate);
            candidates.push(candidate);
        }
    };

    add(url);
    if (!/\/zentao$/i.test(url)) {
        add(`${url}/zentao`);
    }

    return candidates;
}

/** 将 v2 风格的分页查询参数映射为 v1（pageID→page，recPerPage→limit） */
export function translateQueryForV1(
    query: Record<string, string | number>,
): Record<string, string | number> {
    const translated: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(query)) {
        if (key === 'pageID') {
            translated.page = value;
        } else if (key === 'recPerPage') {
            translated.limit = value;
        } else {
            translated[key] = value;
        }
    }
    return translated;
}

/**
 * 将 v1 列表响应中的 `page` / `total` / `limit` 归一化为 v2 风格的 `pager` 字段，
 * 以便现有模块定义与渲染逻辑复用。
 */
export function normalizeV1Response(response: Record<string, unknown>): Record<string, unknown> {
    if (
        response.pager === undefined
        && response.page !== undefined
        && response.total !== undefined
        && response.limit !== undefined
    ) {
        return {
            ...response,
            pager: {
                pageID: Number(response.page),
                recTotal: Number(response.total),
                recPerPage: Number(response.limit),
            },
        };
    }
    return response;
}

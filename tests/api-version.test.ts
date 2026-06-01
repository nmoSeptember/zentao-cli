import { describe, test, expect } from 'bun:test';
import {
    buildApiBaseUrl,
    expandServerCandidates,
    normalizeV1Response,
    translateQueryForV1,
} from '../src/api/version';

describe('api version helpers', () => {
    test('buildApiBaseUrl for v1 and v2', () => {
        expect(buildApiBaseUrl('https://zentao.example.com/zentao', 'v1'))
            .toBe('https://zentao.example.com/zentao/api.php/v1');
        expect(buildApiBaseUrl('https://zentao.example.com/', 'v2'))
            .toBe('https://zentao.example.com/api.php/v2');
    });

    test('expandServerCandidates adds /zentao suffix', () => {
        expect(expandServerCandidates('http://host:81')).toEqual([
            'http://host:81',
            'http://host:81/zentao',
        ]);
        expect(expandServerCandidates('http://host:81/zentao')).toEqual(['http://host:81/zentao']);
    });

    test('translateQueryForV1 maps pagination params', () => {
        expect(translateQueryForV1({ pageID: 2, recPerPage: 50, browseType: 'inside' })).toEqual({
            page: 2,
            limit: 50,
            browseType: 'inside',
        });
    });

    test('normalizeV1Response adds pager from page/total/limit', () => {
        const normalized = normalizeV1Response({
            page: 1,
            total: 10,
            limit: 20,
            products: [],
        });
        expect(normalized.pager).toEqual({
            pageID: 1,
            recTotal: 10,
            recPerPage: 20,
        });
    });
});

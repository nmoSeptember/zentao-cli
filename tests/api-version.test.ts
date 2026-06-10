import { describe, test, expect } from 'bun:test';
import {
    buildApiBaseUrl,
    expandServerCandidates,
    normalizeV1Response,
    translateQueryForV1,
    translateRequestForV1,
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

    test('translateRequestForV1 maps action PUT to POST', () => {
        expect(translateRequestForV1('PUT', '/bugs/22501/resolve')).toEqual({
            method: 'POST',
            path: '/bugs/22501/resolve',
        });
        expect(translateRequestForV1('PUT', '/stories/1/close')).toEqual({
            method: 'POST',
            path: '/stories/1/close',
        });
    });

    test('translateRequestForV1 rewrites bug activate path to active', () => {
        expect(translateRequestForV1('PUT', '/bugs/22501/activate')).toEqual({
            method: 'POST',
            path: '/bugs/22501/active',
        });
    });

    test('translateRequestForV1 leaves CRUD PUT unchanged', () => {
        expect(translateRequestForV1('PUT', '/bugs/22501')).toEqual({
            method: 'PUT',
            path: '/bugs/22501',
        });
    });

    test('translateRequestForV1 leaves v2 GET unchanged', () => {
        expect(translateRequestForV1('GET', '/bugs/22501')).toEqual({
            method: 'GET',
            path: '/bugs/22501',
        });
    });
});

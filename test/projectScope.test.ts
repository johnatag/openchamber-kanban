import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectForDirectory } from '../src/domain/projectScope.ts';
const projects = [{ id: 'padl', name: 'Padl', directory: '/a/padl' }, { id: 'core', name: 'Core', directory: '/a/padl-core/' }, { id: 'root', name: 'Root', directory: '/' }, { id: 'win', name: 'Win', directory: 'C:\\w\\proj' }];
test('directory ownership normalizes path components and folds case only on darwin/win32', () => {
  for (const [directory, id] of [['/a//padl', 'padl'], ['/a/./padl/', 'padl'], ['/a/padl/../other', 'root'], ['/a/padl-core/y', 'core'], ['/a/padlx', 'root'], ['C:\\w\\proj\\sub', 'win'], ['', undefined], [null, undefined]] as const)
    assert.equal(projectForDirectory(projects, directory)?.id, id, String(directory));
  for (const platform of ['darwin', 'win32', 'linux'])
    assert.equal(projectForDirectory(projects, '/A/PADL', platform)?.id, platform === 'linux' ? 'root' : 'padl');
});

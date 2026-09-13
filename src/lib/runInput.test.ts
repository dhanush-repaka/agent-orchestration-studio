import { describe, expect, it } from 'vitest';
import { fieldsFromInput, inputFromFields } from '@/lib/runInput';

describe('run input form', () => {
  it('turns object JSON into fields and back', () => {
    const raw = '{"workItemId":21,"baseUrl":"https://example.com","dryRun":true}';
    const fields = fieldsFromInput(raw);
    expect(fields).toEqual([
      { key: 'workItemId', type: 'number', value: '21' },
      { key: 'baseUrl', type: 'string', value: 'https://example.com' },
      { key: 'dryRun', type: 'boolean', value: 'true' },
    ]);
    expect(JSON.parse(inputFromFields(fields, '{}'))).toEqual({
      workItemId: 21,
      baseUrl: 'https://example.com',
      dryRun: true,
    });
  });
});

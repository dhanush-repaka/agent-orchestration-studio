import { describe, expect, it } from 'vitest';
import {
  extractAdoWorkItem,
  normalizeAdoFields,
  parseAdoStepsXml,
  scenariosFromWorkItem,
  stripHtml,
  testCaseGeneratorPrompt,
  testCasesFromWorkItem,
} from '@/lib/adoWorkItem';

describe('adoWorkItem', () => {
  it('strips HTML and keeps list items', () => {
    expect(stripHtml('<div><p>Reset password</p><ul><li>Send email</li><li>Expire token</li></ul></div>'))
      .toContain('Send email');
  });

  it('parses Azure DevOps test steps XML', () => {
    const xml = `<steps last="2"><step type="ActionStep"><parameterizedString>Open the reset page</parameterizedString><parameterizedString>Reset form is shown</parameterizedString></step><step type="ActionStep"><parameterizedString>Submit a valid email</parameterizedString><parameterizedString>Reset email is sent</parameterizedString></step></steps>`;
    expect(parseAdoStepsXml(xml)).toEqual([
      { action: 'Open the reset page', expected: 'Reset form is shown' },
      { action: 'Submit a valid email', expected: 'Reset email is sent' },
    ]);
  });

  it('turns acceptance criteria into work-item test cases', () => {
    const cases = testCasesFromWorkItem({
      id: 44,
      title: 'Password reset',
      acceptanceCriteria: ['User can request a reset email', 'Token expires after 15 minutes'],
    });
    expect(cases?.map((item) => item.title)).toEqual([
      'User can request a reset email',
      'Token expires after 15 minutes',
    ]);
    expect(cases?.[0].requirementId).toBe('44');
  });

  it('does not invent a catalog from a thin work item', () => {
    expect(testCasesFromWorkItem({ id: 21, title: 'Login', acceptanceCriteria: ['sign in'] })).toBeNull();
  });

  it('prefers the retrieved work item over a generic analysis or run input', () => {
    const retrieved = extractAdoWorkItem({
      'Requirement Analysis': {
        workItemId: 21,
        title: 'Parabank Registration',
        qualityScore: 82,
        acceptanceCriteria: ['valid details'],
      },
      'Data Retrieval': {
        workItemId: 44,
        source: 'azure-devops',
        extractedFields: {
          id: 44,
          title: 'Password reset',
          workItemType: 'User Story',
          description: 'Users reset their password from the profile page.',
          acceptanceCriteria: ['User can request a reset email', 'Token expires after 15 minutes'],
        },
      },
    }, { workItemId: 21 });
    expect(retrieved?.id).toBe(44);
    expect(retrieved?.title).toBe('Password reset');
    expect(scenariosFromWorkItem(retrieved).map((item) => item.title)).toEqual([
      'User can request a reset email',
      'Token expires after 15 minutes',
    ]);
  });

  it('normalizes ADO fields including TCM steps', () => {
    const normalized = normalizeAdoFields({
      'System.Title': 'Checkout',
      'System.WorkItemType': 'Test Case',
      'Microsoft.VSTS.TCM.Steps': '<steps><step><parameterizedString>Open cart</parameterizedString><parameterizedString>Cart is visible</parameterizedString></step></steps>',
    }, 88);
    expect(normalized.title).toBe('Checkout');
    expect(normalized.testSteps).toEqual([{ action: 'Open cart', expected: 'Cart is visible' }]);
    expect(testCasesFromWorkItem(normalized)?.[0].title).toBe('Checkout');
    expect(testCasesFromWorkItem(normalized)?.[0].steps).toEqual(['Open cart (expect: Cart is visible)']);
  });

  it('does not turn a single registration procedure into one case per leftover phrase', () => {
    const cases = testCasesFromWorkItem({
      id: 21,
      title: 'Parabank Registration',
      description: [
        'Goto Parabank site',
        'https://parabank.parasoft.com/parabank/index.htm',
        '- Open',
        'the target URL in the browser using Playwright MCP.',
        'Confirm',
        'the ParaBank home page is displayed.',
        'Click',
        'the Register link.',
        'Inspect',
        'the registration page and identify every required field.',
        'Enter',
        'realistic, unique test data for all mandatory fields:',
        'First Name',
        'Last Name',
        'Address',
        'City',
        'State',
        'Zip',
        'Code',
        'Phone',
        'Number',
        'SSN',
        'Username',
        'Password',
        'Confirm Password',
        'Submit',
        'the registration form.',
      ].join('\n'),
    });
    expect(cases).toHaveLength(1);
    expect(cases?.[0].title).toBe('Parabank Registration');
    expect(cases?.[0].steps.some((step) => step.includes('Click the Register link'))).toBe(true);
    expect(cases?.[0].steps.some((step) => step.includes('Submit the registration form'))).toBe(true);
    expect(cases?.[0].steps).not.toContain('Click');
    expect(cases?.[0].steps).not.toContain('First Name');
    expect(cases?.[0].expectedOutcome).toBe('Submit the registration form.');
  });

  it('asks the model to expand a procedure into several cases', () => {
    const prompt = testCaseGeneratorPrompt({
      id: 21,
      title: 'Parabank Registration',
      description: 'Goto Parabank site\nClick the Register link.\nSubmit the registration form.',
    });
    expect(prompt).toContain('Generate multiple automatable test cases');
    expect(prompt).toContain('Happy-path seed');
    expect(prompt).toContain('Parabank Registration');
  });
});

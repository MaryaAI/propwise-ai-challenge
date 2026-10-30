import { clarifyTemplate, closedTemplate, rentTemplate } from './templates';

describe('templates', () => {
  it('rentTemplate explains listings are for sale only and proposes a follow-up', () => {
    const result = rentTemplate('Priya Nair');
    expect(result.summary).toContain('Priya Nair');
    expect(result.summary.toLowerCase()).toContain('rent');
    expect(result.followUpTask).not.toBeNull();
    expect(result.followUpTask?.title).toContain('Priya Nair');
  });

  it('clarifyTemplate asks for requirements and proposes a follow-up', () => {
    const result = clarifyTemplate('Hassan Ali');
    expect(result.summary).toContain('Hassan Ali');
    expect(result.followUpTask).not.toBeNull();
    expect(result.followUpTask?.title).toContain('Hassan Ali');
  });

  it('closedTemplate acknowledges and proposes no follow-up', () => {
    const result = closedTemplate('Alex Petrov');
    expect(result.summary).toContain('Alex Petrov');
    expect(result.followUpTask).toBeNull();
  });
});

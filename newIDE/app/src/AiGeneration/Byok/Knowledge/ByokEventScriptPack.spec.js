// @flow
import { getByokEventScriptPackExamples } from './ByokEventScriptPack';
import { parseByokEventScript } from '../ByokEventScriptParser';
import {
  getByokKnowledgeSections,
  estimateByokTokens,
  makeByokPromptContext,
} from './ByokKnowledgeSections';

describe('ByokEventScriptPack', () => {
  it('is registered as degradable knowledge after the core sections', () => {
    const pack = getByokKnowledgeSections().find(
      section => section.id === 'eventscript-pack'
    );
    if (!pack) throw new Error('The EventScript pack is not registered');

    expect(pack.degradable).toBe(true);
    expect(pack.priority).toBeGreaterThanOrEqual(200);
  });

  it('fits its own declared budget', () => {
    const pack = getByokKnowledgeSections().find(
      section => section.id === 'eventscript-pack'
    );
    if (!pack) throw new Error('The EventScript pack is not registered');

    const built = pack.build(
      makeByokPromptContext({ toolNames: [], hasOpenedProject: true })
    );
    expect(built.length).toBeGreaterThan(0);
    expect(estimateByokTokens(built)).toBeLessThanOrEqual(pack.budgetTokens);
  });

  it('carries the grammar lines the operational core promises', () => {
    const pack = getByokKnowledgeSections().find(
      section => section.id === 'eventscript-pack'
    );
    if (!pack) throw new Error('The EventScript pack is not registered');
    const text = pack.build(
      makeByokPromptContext({ toolNames: [], hasOpenedProject: true })
    );

    // Statement forms.
    expect(text).toContain('always:');
    expect(text).toContain('else if');
    expect(text).toContain('while Cond():');
    expect(text).toContain('repeat 5 times:');
    expect(text).toContain('for each Enemy:');
    expect(text).toContain('for each child in');
    expect(text).toContain('group "Name":');
    expect(text).toContain('comment "text"');
    // Condition composition.
    expect(text).toContain('and');
    expect(text).toContain('not');
    expect(text).toContain('Or(');
    expect(text).toContain('once');
    expect(text).toContain('disabled ');
    // Escaping, anchors, collapse markers.
    expect(text).toContain('escape');
    expect(text).toContain('# event-');
    expect(text).toContain('# ...');
    // Placement relations.
    expect(text).toContain('expected_event_source');
  });

  describe('every worked example parses with the Phase 5 parser', () => {
    const examples = getByokEventScriptPackExamples();

    test('the pack ships 6 to 10 examples', () => {
      expect(examples.length).toBeGreaterThanOrEqual(6);
      expect(examples.length).toBeLessThanOrEqual(10);
    });

    examples.forEach(example => {
      test(`parses: ${example.name}`, () => {
        const result = parseByokEventScript(example.source);
        if (result.error) {
          throw new Error(
            `Example "${example.name}" does not parse: ${
              result.error.message
            } (line ${result.error.lineNumber}: ${result.error.lineText})`
          );
        }
        expect(result.events).toBeTruthy();
      });
    });
  });
});

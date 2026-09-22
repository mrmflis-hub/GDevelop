// @flow
import {
  BYOK_LOOP_GUARD_CORRECTIVE_MESSAGE,
  BYOK_LOOP_GUARD_HISTORY_SIZE,
  BYOK_LOOP_GUARD_STOP_COUNT,
  BYOK_LOOP_GUARD_TRIGGER_COUNT,
  createByokLoopGuard,
  makeByokCallFingerprint,
} from './ByokLoopGuards';

describe('makeByokCallFingerprint', () => {
  it('is equal for the same name and arguments', () => {
    expect(
      makeByokCallFingerprint('describe_instances', { scene_name: 'S' })
    ).toBe(makeByokCallFingerprint('describe_instances', { scene_name: 'S' }));
  });

  it('differs when the name or the arguments differ', () => {
    expect(
      makeByokCallFingerprint('describe_instances', { scene_name: 'S' })
    ).not.toBe(
      makeByokCallFingerprint('read_scene_events', { scene_name: 'S' })
    );
    expect(
      makeByokCallFingerprint('describe_instances', { scene_name: 'A' })
    ).not.toBe(
      makeByokCallFingerprint('describe_instances', { scene_name: 'B' })
    );
  });

  it('is stable for unparsable arguments (null)', () => {
    expect(makeByokCallFingerprint('wait', null)).toBe('wait(null)');
  });
});

describe('createByokLoopGuard', () => {
  it('lets the first two identical calls through', () => {
    const guard = createByokLoopGuard();
    expect(guard.checkCall('describe_instances', { scene_name: 'S' })).toBe(
      'ok'
    );
    expect(guard.checkCall('describe_instances', { scene_name: 'S' })).toBe(
      'ok'
    );
  });

  it('refuses the third identical call with the corrective verdict', () => {
    const guard = createByokLoopGuard();
    guard.checkCall('describe_instances', { scene_name: 'S' });
    guard.checkCall('describe_instances', { scene_name: 'S' });
    expect(guard.checkCall('describe_instances', { scene_name: 'S' })).toBe(
      'corrective'
    );
    expect(BYOK_LOOP_GUARD_TRIGGER_COUNT).toBe(3);
  });

  it('stops the chat on the fourth identical call', () => {
    const guard = createByokLoopGuard();
    for (let index = 0; index < 3; index++) {
      guard.checkCall('describe_instances', { scene_name: 'S' });
    }
    expect(guard.checkCall('describe_instances', { scene_name: 'S' })).toBe(
      'stop'
    );
    expect(BYOK_LOOP_GUARD_STOP_COUNT).toBe(4);
  });

  it('resets the streak when the arguments change (a different look is progress)', () => {
    const guard = createByokLoopGuard();
    guard.checkCall('describe_instances', { scene_name: 'S' });
    guard.checkCall('describe_instances', { scene_name: 'S' });
    guard.checkCall('describe_instances', { scene_name: 'S2' });
    expect(guard.checkCall('describe_instances', { scene_name: 'S3' })).toBe(
      'ok'
    );
    expect(guard.checkCall('describe_instances', { scene_name: 'S4' })).toBe(
      'ok'
    );
  });

  it('never trips on the plan tool (re-sending updated tasks is normal)', () => {
    const guard = createByokLoopGuard();
    for (let index = 0; index < 10; index++) {
      expect(guard.checkCall('create_or_update_plan', { tasks: [] })).toBe(
        'ok'
      );
    }
  });

  it('counts an identical re-read of an inspection tool (outputs-only is not exempt)', () => {
    const guard = createByokLoopGuard();
    guard.checkCall('read_scene_events', { scene_name: 'S' });
    guard.checkCall('read_scene_events', { scene_name: 'S' });
    expect(guard.checkCall('read_scene_events', { scene_name: 'S' })).toBe(
      'corrective'
    );
  });

  it('keeps at most the last history-size fingerprints', () => {
    const guard = createByokLoopGuard();
    for (let index = 0; index < BYOK_LOOP_GUARD_HISTORY_SIZE + 5; index++) {
      guard.checkCall('describe_instances', { scene_name: `S${index}` });
    }
    expect(guard.getHistory().length).toBe(BYOK_LOOP_GUARD_HISTORY_SIZE);
  });

  it('exposes the corrective message the model reads', () => {
    expect(BYOK_LOOP_GUARD_CORRECTIVE_MESSAGE).toContain(
      'already called this exact tool'
    );
    expect(BYOK_LOOP_GUARD_CORRECTIVE_MESSAGE).toContain(
      'Change your approach'
    );
  });
});

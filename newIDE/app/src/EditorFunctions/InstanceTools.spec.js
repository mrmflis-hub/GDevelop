// @flow
import {
  describeInstancesInContainer,
  extractRequiredString,
  getLayerNameForMessage,
  getOccupiedSpaceDescription,
  INSTANCE_POSITION_SEMANTICS_MESSAGE,
  injectObjectSizeInfo,
  iterateOnInstances,
  makeGenericFailure,
  makeWrongObjectInstanceIdsFailure,
  putInstancesInContainer,
} from './InstanceTools';
import { makeFakeLaunchFunctionOptionsWithProject } from './TestHelpers';
import type { ObjectSizeInfo } from './Utils';
import type { EditorFunctionGenericOutput } from './index';

const gd: libGDevelop = global.gd;

const makeProjectWithSceneAndExternalLayout = () => {
  const project = gd.ProjectHelper.createNewGDJSProject();
  const scene = project.insertNewLayout('TestScene', 0);
  const sceneObjects = scene.getObjects();
  sceneObjects.insertNewObject(project, 'Sprite', 'Player', 0);
  const externalLayout = project.insertNewExternalLayout('SpawnPoint', 0);
  externalLayout.setAssociatedLayout('TestScene');
  return { project, scene, externalLayout };
};

const insertInstance = (
  container: gdInitialInstancesContainer,
  objectName: string,
  x: number,
  y: number
) => {
  const instance = container.insertNewInitialInstance();
  instance.setObjectName(objectName);
  instance.setX(x);
  instance.setY(y);
  return instance;
};

const listInstances = (
  container: gdInitialInstancesContainer
): Array<{| objectName: string, x: number, y: number, id: string |}> => {
  const instances = [];
  iterateOnInstances(container, instance => {
    instances.push({
      objectName: instance.getObjectName(),
      x: instance.getX(),
      y: instance.getY(),
      id: instance.getPersistentUuid().slice(0, 10),
    });
  });
  return instances;
};

describe('InstanceTools', () => {
  let project: gdProject;
  let scene: gdLayout;
  let externalLayout: gdExternalLayout;

  beforeEach(() => {
    const fixtures = makeProjectWithSceneAndExternalLayout();
    project = fixtures.project;
    scene = fixtures.scene;
    externalLayout = fixtures.externalLayout;
  });

  afterEach(() => {
    project.delete();
  });

  describe('extractRequiredString', () => {
    it('returns the string when present', () => {
      expect(extractRequiredString({ name: 'Player' }, 'name')).toBe('Player');
    });

    it('throws on a missing or non-string value', () => {
      expect(() => extractRequiredString({}, 'name')).toThrow(
        'Missing or invalid required string argument: name'
      );
      expect(() => extractRequiredString({ name: 3 }, 'name')).toThrow();
    });
  });

  describe('makeGenericFailure', () => {
    it('builds a failure output', () => {
      expect(makeGenericFailure('Broken.')).toEqual({
        success: false,
        message: 'Broken.',
      });
    });
  });

  describe('getLayerNameForMessage', () => {
    it('names the base layer by its real (empty) name', () => {
      expect(getLayerNameForMessage('')).toBe('the base layer ("")');
      expect(getLayerNameForMessage('UI')).toBe('layer "UI"');
    });
  });

  describe('getOccupiedSpaceDescription', () => {
    it('describes the space from the position and size (origin at the min corner)', () => {
      expect(getOccupiedSpaceDescription([10, 20], [32, 32], null)).toBe(
        'X 10 to 42, Y 20 to 52'
      );
    });

    it('shifts the min corner by the origin, scaled to the actual size', () => {
      const objectSizeInfo: ObjectSizeInfo = {
        width: 64,
        height: 64,
        depth: null,
        originX: 16,
        originY: 32,
        originZ: null,
        centerX: null,
        centerY: null,
        centerZ: null,
      };
      // The origin (16;32 at the default 64x64 size) scales to 8;16 for a
      // 32x32 instance, so the occupied space starts before the position.
      expect(
        getOccupiedSpaceDescription([10, 20], [32, 32], objectSizeInfo)
      ).toBe('X 2 to 34, Y 4 to 36');
    });
  });

  describe('injectObjectSizeInfo', () => {
    const makeSizeInfo = (width: number | null): ObjectSizeInfo => ({
      width,
      height: width,
      depth: null,
      originX: 0,
      originY: 0,
      originZ: null,
      centerX: null,
      centerY: null,
      centerZ: null,
    });

    it('attaches the size info and hints about objects without a known size', () => {
      const output: EditorFunctionGenericOutput = {
        success: true,
        message: 'Done.',
      };
      const knownSize = makeSizeInfo(32);
      const unknownSize = makeSizeInfo(null);

      // The enriched output carries the optional fields the injection set.
      const result: any = injectObjectSizeInfo(output, {
        Player: knownSize,
        Score: unknownSize,
      });
      expect(result.objectSizeInfo.Player).toBe(knownSize);
      expect(result.hints).toHaveLength(1);
      expect(result.hints[0].code).toBe('no-intrinsic-size');
      expect(result.hints[0].objectNames).toEqual(['Score']);
    });

    it('keeps hints a previous injection added', () => {
      const unknownSize = makeSizeInfo(null);
      const emptyOutput: EditorFunctionGenericOutput = {
        success: true,
        message: '',
      };
      const result: any = injectObjectSizeInfo(
        injectObjectSizeInfo(emptyOutput, { Score: unknownSize }),
        { Timer: unknownSize }
      );
      expect(result.hints).toHaveLength(2);
      expect(result.hints[1].objectNames).toEqual(['Timer']);
    });
  });

  describe('INSTANCE_POSITION_SEMANTICS_MESSAGE', () => {
    it('explains the origin-based positioning', () => {
      expect(INSTANCE_POSITION_SEMANTICS_MESSAGE).toContain(
        'origin, NOT its center'
      );
      expect(INSTANCE_POSITION_SEMANTICS_MESSAGE).toContain(
        'center an instance'
      );
    });
  });

  describe('makeWrongObjectInstanceIdsFailure', () => {
    it('lists the offending ids and leaves everything unchanged', () => {
      const output = makeWrongObjectInstanceIdsFailure('Player', [
        '"abc" (instance of "Enemy")',
      ]);
      expect(output.success).toBe(false);
      expect(output.message).toContain('do not belong to object "Player"');
      expect(output.message).toContain('Nothing was changed');
    });
  });

  describe('describeInstancesInContainer', () => {
    it('serializes the instances of a scene layout', () => {
      insertInstance(scene.getInitialInstances(), 'Player', 10, 20);

      const { instances, objectSizeInfoByName } = describeInstancesInContainer({
        initialInstances: scene.getInitialInstances(),
        layersContainer: scene,
        objectsContainer: scene.getObjects(),
        globalObjects: project.getObjects(),
        project,
        PixiResourcesLoader: makeFakeLaunchFunctionOptionsWithProject(project)
          .PixiResourcesLoader,
        objectNames: new Set(),
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].name).toBe('Player');
      expect(instances[0].x).toBe(10);
      expect(instances[0].y).toBe(20);
      expect(typeof instances[0].id).toBe('string');
      expect(Object.keys(objectSizeInfoByName)).toContain('Player');
    });

    it('describes an external layout container through the associated scene layers', () => {
      insertInstance(externalLayout.getInitialInstances(), 'Player', 5, 6);

      const { instances } = describeInstancesInContainer({
        initialInstances: externalLayout.getInitialInstances(),
        layersContainer: scene,
        objectsContainer: scene.getObjects(),
        globalObjects: project.getObjects(),
        project,
        PixiResourcesLoader: makeFakeLaunchFunctionOptionsWithProject(project)
          .PixiResourcesLoader,
        objectNames: new Set(),
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].name).toBe('Player');
    });

    it('filters by object name (case-insensitive)', () => {
      insertInstance(scene.getInitialInstances(), 'Player', 0, 0);
      insertInstance(scene.getInitialInstances(), 'NonMatching', 1, 1);

      const { instances } = describeInstancesInContainer({
        initialInstances: scene.getInitialInstances(),
        layersContainer: scene,
        objectsContainer: scene.getObjects(),
        globalObjects: project.getObjects(),
        project,
        PixiResourcesLoader: makeFakeLaunchFunctionOptionsWithProject(project)
          .PixiResourcesLoader,
        objectNames: new Set(['player']),
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].name).toBe('Player');
    });
  });

  describe('putInstancesInContainer', () => {
    const makePutOptions = (
      project: gdProject,
      container: gdInitialInstancesContainer,
      layersContainer: gdLayout,
      args: Object,
      onInstancesModified: () => void
    ) => ({
      args,
      project,
      toolsVersion: undefined,
      initialInstances: container,
      layersContainer,
      objectsContainer: layersContainer.getObjects(),
      globalObjects: project.getObjects(),
      containerLabel: 'scene "TestScene"',
      onInstancesModified,
      PixiResourcesLoader: makeFakeLaunchFunctionOptionsWithProject(project)
        .PixiResourcesLoader,
    });

    it('creates an instance with the point brush', async () => {
      let notified = 0;
      const output = await putInstancesInContainer(
        makePutOptions(
          project,
          scene.getInitialInstances(),
          scene,
          {
            layer_name: '',
            brush_kind: 'point',
            brush_position: '100, 150',
            object_name: 'Player',
            new_instances_count: 1,
          },
          () => {
            notified++;
          }
        )
      );

      expect(output.success).toBe(true);
      expect(notified).toBe(1);
      const instances = listInstances(scene.getInitialInstances());
      expect(instances).toHaveLength(1);
      expect(instances[0].objectName).toBe('Player');
      expect(instances[0].x).toBe(100);
      expect(instances[0].y).toBe(150);
    });

    it('erases instances by id', async () => {
      const instance = insertInstance(
        scene.getInitialInstances(),
        'Player',
        0,
        0
      );
      const id = instance.getPersistentUuid().slice(0, 10);

      const output = await putInstancesInContainer(
        makePutOptions(
          project,
          scene.getInitialInstances(),
          scene,
          {
            layer_name: '',
            brush_kind: 'erase',
            object_name: 'Player',
            existing_instance_ids: id,
          },
          () => {}
        )
      );

      expect(output.success).toBe(true);
      expect(listInstances(scene.getInitialInstances())).toHaveLength(0);
    });

    it('fails with the container label when the layer does not exist', async () => {
      const output = await putInstancesInContainer(
        makePutOptions(
          project,
          scene.getInitialInstances(),
          scene,
          {
            layer_name: 'NoSuchLayer',
            brush_kind: 'point',
            brush_position: '0, 0',
            object_name: 'Player',
            new_instances_count: 1,
          },
          () => {}
        )
      );

      expect(output.success).toBe(false);
      expect(output.message).toContain('Layer not found: NoSuchLayer');
      expect(output.message).toContain('in scene "TestScene"');
    });

    it('populates an external layout container without touching the scene', async () => {
      const output = await putInstancesInContainer(
        makePutOptions(
          project,
          externalLayout.getInitialInstances(),
          scene,
          {
            layer_name: '',
            brush_kind: 'point',
            brush_position: '7, 8',
            object_name: 'Player',
            new_instances_count: 2,
          },
          () => {}
        )
      );

      expect(output.success).toBe(true);
      expect(listInstances(externalLayout.getInitialInstances())).toHaveLength(
        2
      );
      expect(listInstances(scene.getInitialInstances())).toHaveLength(0);
    });
  });
});

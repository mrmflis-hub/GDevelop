/**
 * The prompts of the BYOK eval suite (Phase 9.8), keyed by task id. Kept in
 * their own file so the wording can be iterated (and diffed) without
 * touching the runner.
 */

'use strict';

module.exports = {
  // ---- Event-logic (10) ----
  'coin-spawner-every-3s':
    'In scene "Level 1", write an event: every 3 seconds (timer condition "BuiltinCommonInstructions::Timer", timer name "spawn"), create a new instance of object "Coin" at position 100, 200 via "CreerObjet". Use the add_scene_events tool.',
  'player-movement-8-directions':
    'In scene "Level 1", add events so the object "Player" moves with forces in the 8 directions of the keyboard (use force actions). Use the add_scene_events tool.',
  'enemy-patrol-left-right':
    'In scene "Level 1", "Enemy" patrols horizontally: apply a horizontal force of 200 px/s and flip the object when its XDirection changes. Use the add_scene_events tool.',
  'jump-when-space-pressed':
    'In scene "Level 1", when the Space key is pressed, apply a vertical jump force to "Player". Use the add_scene_events tool.',
  'damage-on-collision':
    'In scene "Level 1", when "Player" collides with "Enemy", decrease the object variable "hp" of Player. Use the add_scene_events tool.',
  'score-increases-on-pickup':
    'In scene "Level 1", when "Player" collides with "Coin", add 10 to the global variable Score and delete the coin. Use the add_scene_events tool.',
  'timer-based-difficulty-ramp':
    'In scene "Level 1", every 10 seconds (timer "ramp", properly reset each time), increase the global variable "Difficulty" by 1. Use the add_scene_events tool.',
  'delete-object-when-offscreen':
    'In scene "Level 1", delete (Supprimer) any instance of "Bullet" as soon as it leaves the scene (DepartDeLaScene). Use the add_scene_events tool.',
  'scene-change-on-goal':
    'In scene "Level 1", when "Player" collides with "Goal", change the scene to "Level 2" (ChangeScene). Use the add_scene_events tool.',
  'while-loop-spawn-grid':
    'In scene "Level 1", use a While event to create 5 instances of "Block" in a row, incrementing a counter variable each time. Use the add_scene_events tool.',

  // ---- Layout/spatial (5) ----
  'grid-5x5-platform':
    'Place instances of "Platform" on a perfect 5×5 grid: x from 0 to 512 (spacing 128), y from 0 to 512 (spacing 128). Use put_2d_instances.',
  'wall-of-3x8-bricks':
    'Place instances of "Brick" as a wall: 3 columns, 8 rows, spacing 64 both ways, starting at (0, 0). Use put_2d_instances.',
  'row-of-6-lamps':
    'Place 6 instances of "Lamp" in a single row: y = 0, x from 0 with a spacing of 200. Use put_2d_instances.',
  'two-by-two-turrets':
    'Place 4 instances of "Turret" on a 2×2 grid with spacing 300 both ways, starting at (0, 0). Use put_2d_instances.',
  'stairs-of-4-platforms':
    'Place 4 instances of "Step" as a staircase going up to the right: each 128 px further right and 64 px higher (y decreases) than the previous one, starting at (0, 640). Use put_2d_instances.',

  // ---- Variables/properties (5) ----
  'global-score-number':
    'Create a global variable named "Score" of type number (starting at 0). Use add_or_edit_variable.',
  'scene-health-variable':
    'Create a scene variable named "Health" in scene "Level 1", with initial value 3. Use add_or_edit_variable.',
  'player-structure-variable':
    'Create a structure variable named "Inventory" (type: structure). Use add_or_edit_variable.',
  'object-ammo-variable':
    'Create a variable named "Ammo" on the object "Player" (object-scoped). Use add_or_edit_variable.',
  'boolean-has-key':
    'Create a variable named "HasKey" that is true from the start. Use add_or_edit_variable.',

  // ---- JS/extension (5) ----
  'js-spawn-every-seconds':
    'Write JavaScript code (run_script) that registers a timed task spawning one "Coin" every 3 seconds: use runtimeScene.getObjects and the TimedTask manager in your answer text.',
  'js-read-object-position':
    'Write JavaScript code that reads the position of an object and returns it: your answer must use getX() and getY().',
  'js-change-scene':
    'Write JavaScript code that pushes a new scene on the scene stack: use runtimeScene.getSceneStackAndPush or the scene stack push API in your answer.',
  'extension-action-with-expression':
    'Write the skeleton of a GDevelop extension declaring one action: your answer must mention extension and addAction.',
  'js-camera-follow':
    'Write JavaScript code making the camera follow the player: your answer must use getCamera and setX.',

  // ---- Perception-repair (5) ----
  'hud-score-overlaps-button':
    'The preview screenshot shows "ScoreText" overlapping another HUD element at (20, 20); both are 64×64. Move ScoreText (set_instance_position) so the two no longer overlap (e.g. x = 300, y = 20).',
  'health-bar-overlaps-minimap':
    'The screenshot shows "HealthBar" stacked on the minimap at (400, 20); both are 64×64. Move HealthBar (set_instance_position) somewhere clear of it.',
  'joystick-overlaps-jump-button':
    'The screenshot shows "JumpButton" overlapping the joystick at (60, 400); both are 80×80. Move JumpButton (set_instance_position) so they no longer overlap.',
  'quest-text-overlaps-inventory':
    'The screenshot shows "QuestText" covering the inventory panel at (200, 150); the panel is 100×100. Move QuestText (set_instance_position) clear of it.',
  'boss-bar-overlaps-score':
    'The screenshot shows "BossBar" on top of the score display at (320, 30); both are 64×64. Move BossBar (set_instance_position) so the score is readable.',
};

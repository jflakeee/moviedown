import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskManager } from '../task-manager.js';

test('task lifecycle and single active operation', () => {
  let state;
  const jobs=createTaskManager(s=>{state=s});
  assert.equal(jobs.busy(),false);
  jobs.start('upload','test.mp4');
  assert.equal(state.active.status,'queued');
  assert.throws(()=>jobs.start('analysis','other'));
  jobs.update('uploading','50%',50);
  assert.equal(state.active.progress,50);
  jobs.finish('completed','done');
  assert.equal(state.recent[0].status,'completed');
  assert.equal(state.recent[0].progress,100);
  assert.equal(jobs.busy(),false);
});

test('failed and cancelled jobs remain in bounded recent history', () => {
  let state;
  const jobs=createTaskManager(s=>{state=s},2);
  for(const outcome of ['failed','cancelled','completed']){
    jobs.start('analysis',outcome);
    jobs.finish(outcome,outcome);
  }
  assert.deepEqual(state.recent.map(x=>x.status),['completed','cancelled']);
  assert.equal(state.active,null);
});

test('bad transitions are rejected', () => {
  const jobs=createTaskManager(()=>{});
  jobs.start('upload','one');
  assert.throws(()=>jobs.update('completed','wrong'));
  assert.throws(()=>jobs.finish('uploading','wrong'));
  jobs.finish('failed','error');
});

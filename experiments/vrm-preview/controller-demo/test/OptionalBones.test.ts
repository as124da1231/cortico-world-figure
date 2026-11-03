import assert from "node:assert/strict";
import * as THREE from "three";
import { VRMHumanBoneParentMap, type VRM, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { test } from "vitest";
import { sourceBoneToHumanBone } from "../src/character/VrmAnimationContract";
import { retargetHumanoidAnimationClips } from "../src/character/VrmAnimation";

function fixture(omitted: string[]) {
  const scene = new THREE.Group();
  const bones = new Map<VRMHumanBoneName, THREE.Object3D>();
  for (const name of Object.values(sourceBoneToHumanBone)) {
    if (!omitted.includes(name)) bones.set(name, new THREE.Bone());
  }
  for (const [name, bone] of bones) {
    let parent = VRMHumanBoneParentMap[name];
    while (parent && !bones.has(parent)) parent = VRMHumanBoneParentMap[parent];
    (parent ? bones.get(parent)! : scene).add(bone);
  }
  scene.updateWorldMatrix(true, true);
  const vrm = { scene, meta: { metaVersion: "1" }, humanoid: {
    getNormalizedBoneNode: (name: VRMHumanBoneName) => bones.get(name),
    getRawBoneNode: (name: VRMHumanBoneName) => bones.get(name),
  } } as unknown as VRM;
  const makeClip = (name: string, animated: boolean) => new THREE.AnimationClip(name, 1,
    ["root", ...Object.keys(sourceBoneToHumanBone)].map(source => {
      const rotation = new THREE.Quaternion();
      if (source === "DEF-spine003" && animated) rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
      return new THREE.QuaternionKeyframeTrack(`${source}.quaternion`, [0, 1], [...rotation.toArray(), ...rotation.toArray()]);
    }));
  return { vrm, bones, clips: [makeClip("A_TPose", false), makeClip("Walk_Loop", true)] };
}

test("optional upperChest rotation reaches neck and shoulders without an upperChest target", () => {
  const { vrm, bones, clips } = fixture(["upperChest"]);
  const [clip] = retargetHumanoidAnimationClips(clips, vrm, ["Walk_Loop"]);
  const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
  for (const name of ["neck", "leftShoulder", "rightShoulder"] as const) {
    const track = clip.tracks.find(t => t.name === `${bones.get(name)!.uuid}.quaternion`)!;
    assert.ok(track);
    assert.ok(new THREE.Quaternion().fromArray(track.values).angleTo(expected) < 1e-6);
  }
});

test("missing required lower leg still produces an actionable model error", () => {
  const { vrm, clips } = fixture(["leftLowerLeg"]);
  assert.throws(() => retargetHumanoidAnimationClips(clips, vrm, ["Walk_Loop"]), /missing required humanoid bones.*leftLowerLeg/);
});

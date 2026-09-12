import { test, expect, Page } from "@playwright/test";
import { createLandmarkProject } from "../../src/domain/landmarks/presets";
import { createCurve } from "../../src/domain/curves/management";
import { createJunction } from "../../src/domain/junctions/management";
import { resolveNetwork } from "../../src/domain/junctions/resolve";
import { controls, bezier } from "../../src/domain/curves/geometry";
import { project } from "../../src/domain/geometry/core";
import { mirror } from "../../src/domain/landmarks/model";
import type { Vec3 } from "../../src/domain/project/types";
const state = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("contour.landmarks.v035")!));
function fixture() {
  let p = createLandmarkProject();
  const ids = p.centerlineOrder,
    coords: Vec3[] = [
      [0, 0.8, 0],
      [0, 0, 0],
      [0, 0, 0.8],
      [0, -0.8, 0],
      [0, 0, -0.8],
      [0, -0.8, 0.8],
    ];
  p = {
    ...p,
    landmarks: p.landmarks.map((l) =>
      ids.includes(l.id) ? { ...l, position: coords[ids.indexOf(l.id)] } : l,
    ),
  };
  p = createCurve(p, ids[0], ids[1], p.views[0], "鼻梁线").project;
  p = createCurve(p, ids[1], ids[2], p.views[0], "鼻底线").project;
  return { p, ids };
}
async function load(page: Page, p: any) {
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "junction-fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
const chooseView = (p: Page, name: string) =>
  p
    .locator(".point-view-tabs")
    .getByRole("button", { name, exact: true })
    .click();
async function movePanel(p: Page) {
  const b = await p.getByTestId("junction-header").boundingBox();
  await p.mouse.move(b!.x + 50, b!.y + 10);
  await p.mouse.down();
  await p.mouse.move(1170, 220, { steps: 8 });
  await p.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("inspector creates G1, resolved picking, hover, extent one history step and lossless remove", async ({
  page,
}, info) => {
  const { p, ids } = fixture();
  await load(page, p);
  await chooseView(page, "侧面");
  await page.getByTestId("landmark-山根点").click({ button: "right" });
  const panel = page.getByRole("region", { name: "交点检查器", exact: true });
  await expect(panel).toContainText("Corner");
  await movePanel(page);
  const before = await state(page);
  await panel.getByRole("button", { name: "设为平滑", exact: true }).click();
  let q = await state(page);
  expect(q.smoothJunctions.length).toBe(1);
  expect(q.curves).toEqual(before.curves);
  expect(q.landmarks).toEqual(before.landmarks);
  const j = q.smoothJunctions[0];
  await expect(page.locator(`[data-testid^="blend-${j.id}-"]`)).toHaveCount(8);
  const original = controls(q, q.curves[0]),
    v = q.views.find((v: any) => v.id === "side")!;
  const outerPath = await page
    .getByTestId(`curve-hit-${q.curves[0].id}`)
    .getAttribute("d");
  const range = resolveNetwork(q).spans.find(
    (s) => s.kind === "outer" && s.curveId === q.curves[0].id,
  )!.sourceRange!;
  expect(range[1] - range[0]).toBeLessThan(1);
  expect(outerPath).not.toContain("NaN");
  await panel.locator(".junction-pair").hover();
  await expect(page.getByTestId("junction-hover-marker")).toHaveCount(3);
  const slider = panel.getByRole("slider", { name: "平滑范围" }),
    box = await slider.boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.35, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const changed = await state(page);
  expect(changed.smoothJunctions[0].extent).not.toBe(
    q.smoothJunctions[0].extent,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).smoothJunctions).toEqual(q.smoothJunctions);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await state(page)).smoothJunctions).toEqual(changed.smoothJunctions);
  await chooseView(page, "右 30°");
  await expect(panel).toBeVisible();
  await chooseView(page, "侧面");
  // A derived blend opens its junction and cannot be dragged into a new source shape.
  await panel
    .getByRole("button", { name: "关闭交点检查器", exact: true })
    .click();
  const hit = page.getByTestId(`blend-hit-${j.id}-${j.sideA.curveId}`);
  const pt = await hit.evaluate((node) => {
    const p = node as SVGPathElement,
      q = p.getPointAtLength(p.getTotalLength() / 2),
      w = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM()!);
    return { x: w.x, y: w.y };
  });
  const prior = await state(page);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 20, pt.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(panel).toBeVisible();
  expect((await state(page)).curves).toEqual(prior.curves);
  await page.screenshot({ path: info.outputPath("smooth-junction.png") });
  await panel.getByRole("button", { name: "取消平滑", exact: true }).click();
  q = await state(page);
  expect(q.smoothJunctions).toEqual([]);
  expect(q.curves).toEqual(p.curves);
});
test("invalid record remains occupied and editable, recovers after source Undo; cascade and save/load", async ({
  page,
}) => {
  const f = fixture();
  let p = createJunction(
    f.p,
    f.ids[1],
    { curveId: f.p.curves[0].id, endpoint: "end" },
    { curveId: f.p.curves[1].id, endpoint: "start" },
  );
  await load(page, p);
  await chooseView(page, "侧面");
  await page.getByTestId("landmark-山根点").dblclick();
  await movePanel(page);
  // Load an invalid source shape without persisting any derived status.
  const bad = {
    ...p,
    landmarks: p.landmarks.map((l) =>
      l.id === f.ids[2] ? { ...l, position: [0, 1.3, 0] as Vec3 } : l,
    ),
  };
  await load(page, bad);
  const panel = page.getByRole("region", { name: "交点检查器", exact: true });
  await expect(panel).toContainText("当前平滑连接无效");
  await expect(
    panel.getByRole("button", { name: "设为平滑", exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "＋ 添加平滑配对", exact: true }),
  ).toBeDisabled();
  await panel.getByRole("slider", { name: "平滑范围" }).focus();
  await page.keyboard.press("ArrowRight");
  expect((await state(page)).smoothJunctions[0].extent).toBe(0.16);
  await expect(panel).toContainText("当前平滑连接无效");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(panel).toContainText("Smooth · G1");
  expect((await state(page)).smoothJunctions).toEqual(p.smoothJunctions);
  const saved = await state(page);
  await page.reload();
  expect((await state(page)).smoothJunctions).toEqual(saved.smoothJunctions);
  expect(resolveNetwork(await state(page))).toEqual(resolveNetwork(saved));
  await page
    .locator(".curve-list")
    .getByRole("button", { name: "鼻梁线", exact: true })
    .click();
  await page.keyboard.press("Delete");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  expect((await state(page)).smoothJunctions).toEqual([]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).smoothJunctions).toEqual(saved.smoothJunctions);
});
test("high valence pairing uses free endpoint slots and mirror inspector edits one extent", async ({
  page,
}) => {
  let p = createLandmarkProject();
  const rs = p.landmarks.filter((l) => l.type === "RIGHT").slice(0, 5),
    coords: Vec3[] = [
      [-0.6, 0.6, 0],
      [-0.6, 0, 0],
      [-0.2, -0.3, 0],
      [-1, -0.3, 0],
      [-0.6, -0.7, 0],
    ];
  p = {
    ...p,
    landmarks: p.landmarks.map((l) => {
      const i = rs.findIndex(
        (r) => r.id === l.id || r.mirrorPartnerId === l.id,
      );
      return i < 0
        ? l
        : {
            ...l,
            position: l.type === "RIGHT" ? coords[i] : mirror(coords[i]),
          };
    }),
  };
  for (const i of [0, 2, 3, 4])
    p = createCurve(p, rs[1].id, rs[i].id, p.views[0], `线${i}`).project;
  await load(page, p);
  await page.getByTestId(`landmark-${rs[1].name}`).click({ button: "right" });
  await movePanel(page);
  const panel = page.getByRole("region", { name: "交点检查器", exact: true });
  await panel
    .getByRole("button", { name: "＋ 添加平滑配对", exact: true })
    .click();
  await panel
    .getByLabel("第一条结构线")
    .selectOption(`${p.curves[0].id}:start`);
  await panel
    .getByLabel("第二条结构线")
    .selectOption(`${p.curves[2].id}:start`);
  await panel.getByRole("button", { name: "建立平滑", exact: true }).click();
  let q = await state(page);
  expect(q.smoothJunctions.length).toBe(1);
  expect(resolveNetwork(q).junctions.length).toBe(2);
  const left = p.landmarks.find((l) => l.id === rs[1].mirrorPartnerId)!;
  await page.getByTestId(`landmark-${left.name}`).click({ button: "right" });
  await panel.getByRole("slider", { name: "平滑范围" }).focus();
  await page.keyboard.press("ArrowRight");
  q = await state(page);
  expect(q.smoothJunctions.length).toBe(1);
  expect(q.smoothJunctions[0].extent).toBe(0.16);
  expect(resolveNetwork(q).junctions.every((j) => j.state === "VALID")).toBe(
    true,
  );
});

import { readFileSync } from "node:fs";
import { test, expect, Page } from "@playwright/test";
import { createLandmarkProject } from "../../src/domain/landmarks/presets";
import { createCurve } from "../../src/domain/curves/management";
import { resolveNetwork } from "../../src/domain/surfaceSmooth/solver";
import { config } from "../../src/domain/surfaceSmooth/config";
import type { Vec3 } from "../../src/domain/project/types";
const state = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("contour.landmarks.v038")!));
async function load(page: Page, p: any) {
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "node.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
}
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
const panel = (p: Page) =>
  p.getByRole("region", { name: "Surface Smooth Node 检查器", exact: true });
async function open(page: Page) {
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name: "侧面", exact: true })
    .click();
  await page.getByTestId("landmark-山根点").click({ button: "right" });
  const b = await page.getByTestId("junction-header").boundingBox();
  await page.mouse.move(b!.x + 50, b!.y + 10);
  await page.mouse.down();
  await page.mouse.move(1160, 220, { steps: 8 });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("node inspector default-on, exact valence2, exclusions, OFF, slider history and debug", async ({
  page,
}, info) => {
  const { p, ids } = fixture();
  await load(page, p);
  await open(page);
  const ui = panel(page);
  await expect(ui.getByLabel("Surface Smooth", { exact: true })).toBeChecked();
  await expect(ui).toContainText("平滑稳定");
  const before = await state(page);
  expect(resolveNetwork(before).spans.every((s) => s.kind === "outer")).toBe(
    true,
  );
  await ui.getByLabel("鼻梁线 · 终点", { exact: true }).uncheck();
  await expect(ui).toContainText("参与结构线不足 2 条");
  await ui.getByLabel("Surface Smooth", { exact: true }).uncheck();
  expect(config(await state(page), ids[1]).excludedHalfEdges.length).toBe(1);
  await ui.getByLabel("Surface Smooth", { exact: true }).check();
  await ui.getByLabel("鼻梁线 · 终点", { exact: true }).check();
  const prior = await state(page);
  const slider = ui.getByRole("slider", { name: "平滑范围" }),
    b = await slider.boundingBox();
  await page.mouse.move(b!.x + b!.width * 0.25, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width * 0.7, b!.y + b!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  const changed = await state(page);
  expect(config(changed, ids[1]).extent).not.toBe(config(prior, ids[1]).extent);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).surfaceSmoothNodes).toEqual(
    prior.surfaceSmoothNodes,
  );
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await state(page)).surfaceSmoothNodes).toEqual(
    changed.surfaceSmoothNodes,
  );
  await ui.getByLabel("显示平滑调试").check();
  await expect(page.getByTestId("surface-debug-plane")).toHaveCount(1);
  expect((await state(page)).landmarks).toEqual(before.landmarks);
  expect((await state(page)).curves).toEqual(before.curves);
  await page.screenshot({
    path: info.outputPath("surface-node-inspector.png"),
  });
});
test("invalid source retains node config, slider editable and source undo recovers", async ({
  page,
}) => {
  const { p, ids } = fixture();
  await load(page, p);
  await open(page);
  const bad = {
    ...p,
    landmarks: p.landmarks.map((l) =>
      l.id === ids[0] ? { ...l, position: [0, 0, 0] } : l,
    ),
  };
  await load(page, bad);
  await expect(panel(page)).toContainText("当前平滑无效");
  const slider = panel(page).getByRole("slider", { name: "平滑范围" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  expect(config(await state(page), ids[1]).extent).toBe(0.16);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(panel(page)).toContainText("平滑稳定");
});
test("actual ear/eye migrate, no displaced V, export source only and reload", async ({
  page,
}, info) => {
  const raw = JSON.parse(
    readFileSync("src/tests/fixtures/ear-eye.json", "utf8"),
  );
  await load(page, raw);
  const saved = await state(page);
  expect(saved.smoothJunctions).toBeUndefined();
  expect(saved.version).toBe("landmarks-0.3.8");
  expect(saved.landmarks.map((l: any) => l.position)).toEqual(
    raw.landmarks.map((l: any) => l.position),
  );
  expect(saved.curves).toEqual(raw.curves);
  const net = resolveNetwork(saved);
  for (const span of net.spans)
    expect(span.controls.flat().every(Number.isFinite)).toBe(true);
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name: "右 30°", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("surface-node-ear-eye.png") });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存 JSON", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  let text = "";
  for await (const chunk of stream!) text += chunk.toString();
  const exported = JSON.parse(text);
  expect(exported.surfaceSmoothNodes).toEqual(saved.surfaceSmoothNodes);
  expect(exported.smoothJunctions).toBeUndefined();
  expect(JSON.stringify(exported.surfaceSmoothNodes)).not.toMatch(
    /normal|trimPoint|stress|INVALID/,
  );
  await load(page, exported);
  expect((await state(page)).surfaceSmoothNodes).toEqual(
    saved.surfaceSmoothNodes,
  );
  await page.reload();
  expect(resolveNetwork(await state(page))).toEqual(net);
});
test("resolved fairing picking edits original source curve and undo restores it", async ({
  page,
}, info) => {
  const raw = JSON.parse(
    readFileSync("artifacts/head-neck-refinement/refined.json", "utf8"),
  );
  await load(page, raw);
  const before = await state(page);
  const { basis, dot } = await import("../../src/domain/geometry/core");
  const { canonical } = await import("../../src/domain/curves/geometry");
  const v = before.views.find((x: any) => x.id === "front");
  const candidates = resolveNetwork(before).spans.filter(
    (s) =>
      s.kind === "blend" &&
      Math.abs(
        dot(
          canonical(
            before,
            before.curves.find((c: any) => c.id === s.curveId),
          ).shape.planeNormal,
          basis(v).forward,
        ),
      ) > 0.25,
  );
  let picked: string | undefined;
  for (const span of candidates) {
    const hit = page.getByTestId(
      `blend-hit-${span.landmarkId}-${span.curveId}`,
    );
    const pt = await hit.evaluate((node) => {
      const p = node as SVGPathElement;
      for (let i = 5; i < 16; i++) {
        const q = p.getPointAtLength((p.getTotalLength() * i) / 20),
          w = new DOMPoint(q.x, q.y).matrixTransform(p.getScreenCTM()!);
        if (document.elementFromPoint(w.x, w.y) === node)
          return { x: w.x, y: w.y };
      }
      return null;
    });
    if (!pt) continue;
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 8, pt.y + 5, { steps: 5 });
    await page.mouse.up();
    picked = span.curveId;
    break;
  }
  expect(picked).toBeTruthy();
  const after = await state(page);
  expect(after.curves).not.toEqual(before.curves);
  expect(after.landmarks).toEqual(before.landmarks);
  expect(after.surfaceSmoothNodes).toEqual(before.surfaceSmoothNodes);
  await page.screenshot({
    path: info.outputPath("refined-head-resolved-edit.png"),
  });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).curves).toEqual(before.curves);
});

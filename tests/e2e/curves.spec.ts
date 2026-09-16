import {savedProject} from '../helpers/persistence';
import {selectSidebar} from "../helpers/sidebar";
import { test, expect, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const state = savedProject;
const pick = (p: Page,n:string)=>selectSidebar(p,"landmark",n);
async function create(p: Page, a: string, b: string) {
  const h=p.locator(".curve-panel .section-heading");if(await h.getAttribute("aria-expanded")==="false")await h.click();
  await p.getByRole("button", { name: "创建曲线", exact: true }).click();
  await pick(p, a);
  await pick(p, b);
}
async function dragBody(p: Page, id: string, dx: number, dy: number) {
  const q = await p.getByTestId(`curve-hit-${id}`).evaluate((node) => {
    const path = node as SVGPathElement;
    const q = path.getPointAtLength(path.getTotalLength() * 0.5);
    const screen = new DOMPoint(q.x, q.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await p.mouse.move(q.x, q.y);
  await p.mouse.down();
  await p.mouse.move(q.x + dx, q.y + dy, { steps: 8 });
  await p.mouse.up();
}
async function dragHandle(p: Page, index: number, dx: number, dy: number) {
  const b = await p.getByTestId(`curve-handle-${index}`).boundingBox();
  await p.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await p.mouse.down();
  await p.mouse.move(b!.x + b!.width / 2 + dx, b!.y + b!.height / 2 + dy, {
    steps: 8,
  });
  await p.mouse.up();
}
const owner = (p: any) => p.curves.find((c: any) => c.role === "canonical");
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建", exact: true }).click();
});
test("body C, handles S, mirror edit, plane rotation, all views and actual JSON save/load", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page, "右眉头点", "右眉尾点");
  const initial = await state(page),
    c = owner(initial),
    follower = initial.curves.find((x: any) => x.role === "mirror");
  expect(initial.curves.length).toBe(2);
  await dragBody(page, c.id, 0, -35);
  let p = await state(page);
  expect(
    owner(p).shape.startHandle.offset * owner(p).shape.endHandle.offset,
  ).toBeGreaterThan(0);
  expect(p.landmarks).toEqual(initial.landmarks);
  const curved = p;
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).curves).toEqual(initial.curves);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await state(page)).curves).toEqual(curved.curves);
  await selectSidebar(page,"curve",c.name);
  await dragHandle(page, 2, 0, 100);
  p = await state(page);
  expect(
    owner(p).shape.startHandle.offset * owner(p).shape.endHandle.offset,
  ).toBeLessThan(0);
  await selectSidebar(page,"curve",follower.name);
  const beforeMirror = await state(page);
  await dragHandle(page, 1, 0, -10);
  p = await state(page);
  expect(owner(p).shape).not.toEqual(owner(beforeMirror).shape);
  expect(p.curves.find((c: any) => c.role === "mirror").shape).toBeUndefined();
  expect(p.landmarks).toEqual(initial.landmarks);
  const beforeRotate = p;
  await page.getByRole("slider", { name: "调整曲线平面" }).focus();
  await page.keyboard.press("ArrowRight");
  p = await state(page);
  expect(owner(p).shape.planeNormal).not.toEqual(
    owner(beforeRotate).shape.planeNormal,
  );
  expect(owner(p).shape.startHandle).toEqual(
    owner(beforeRotate).shape.startHandle,
  );
  expect(owner(p).shape.endHandle).toEqual(owner(beforeRotate).shape.endHandle);
  for (const name of ["右 30°", "右 45°", "侧面", "俯 45°", "纯俯视"]) {
    await page
      .locator(".point-view-tabs")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator(`[data-testid="curve-${c.id}"]`)).toHaveCount(1);
    expect((await state(page)).curves).toEqual(p.curves);
  }
  await page.screenshot({ path: info.outputPath("planar-curves.png") });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存 JSON", exact: true }).click();
  const download = await downloadPromise,
    saved = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(saved.curves).toEqual(p.curves);
  await page.reload();
  expect((await state(page)).curves).toEqual(saved.curves);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "curves.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await expect
    .poll(async () => (await state(page)).curves)
    .toEqual(saved.curves);
  expect(errors).toEqual([]);
});
test("endpoint transport, duplicate and cascade history; multiple edges and pair management", async ({
  page,
}) => {
  await create(page, "右眉头点", "右眉尾点");
  const first = await state(page);
  await dragBody(page, owner(first).id, 0, -20);
  const before = await state(page);
  await pick(page, "右眉尾点");
  await page.getByTestId("landmark-右眉尾点").focus();
  await page.keyboard.press("ArrowUp");
  // Geometry assertion during a keyboard edit reads live state, not deferred autosave.
  const moved = await page.evaluate(()=>(window as any).__editorPerfStore.getState().project);
  expect(owner(moved).shape.startHandle).toEqual(
    owner(before).shape.startHandle,
  );
  expect(owner(moved).shape.planeNormal).not.toEqual(
    owner(before).shape.planeNormal,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).curves).toEqual(before.curves);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await state(page)).curves).toEqual(moved.curves);
  await create(page, "右眉头点", "右眉尾点");
  expect((await state(page)).curves.length).toBe(4);
  const selected = (await state(page)).curves.at(-1);
  await selectSidebar(page,"curve",selected.name);
  await page.locator(".curve-list .active .entity-name").dblclick();
  await page.getByLabel("结构线名称").fill("上眼睑线");
  await page.getByLabel("结构线名称").press("Enter");
  expect(
    (await state(page)).curves
      .slice(-2)
      .map((c: any) => c.name)
      .sort(),
  ).toEqual(["右上眼睑线", "左上眼睑线"].sort());
  await page.locator(".point-workspace").focus();
  await page.keyboard.press("Delete");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  expect((await state(page)).curves.length).toBe(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const cascade = await state(page);
  await pick(page, "右眉头点");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog")).toContainText("4 条相连结构线");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  expect((await state(page)).curves).toEqual([]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).curves).toEqual(cascade.curves);
  expect((await state(page)).landmarks).toEqual(cascade.landmarks);
});
test("sagittal curve, shared center pair, lock does not constrain shape; creation in canvas", async ({
  page,
}) => {
  await page.locator(".curve-panel .section-heading").click();
  await page.getByRole("button", { name: "创建曲线", exact: true }).click();
  await page.getByTestId("landmark-山根点").click();
  await page.getByTestId("landmark-鼻尖点").click();
  expect((await state(page)).curves.length).toBe(1);
  await expect(page.getByText("固定于中线平面 · 无旋转自由度")).toBeVisible();
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name: "侧面", exact: true })
    .click();
  const c = owner(await state(page));
  await dragBody(page, c.id, 25, 0);
  expect(owner(await state(page)).shape.planeNormal).toEqual([1, 0, 0]);
  await create(page, "鼻尖点", "右嘴角点");
  expect((await state(page)).curves.length).toBe(3);
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name: "正面", exact: true })
    .click();
  await create(page, "右眉头点", "右眉尾点");
  const newest = (await state(page)).curves.at(-2);
  await page.getByLabel("锁定此视图全部点").check();
  const locked = await state(page);
  await dragBody(page, newest.id, 0, -15);
  const changed = await state(page);
  expect(changed.landmarks).toEqual(locked.landmarks);
  expect(changed.curves).not.toEqual(locked.curves);
});

test("V0.2 autosave migration preserves original data and compact layout supports curves", async ({
  page,
}) => {
  const legacy = await state(page);
  delete legacy.curves;
  legacy.version = "landmarks-0.2";
  await page.evaluate((p) => {
    localStorage.setItem("contour.landmarks.v02", JSON.stringify(p));
    localStorage.removeItem("contour.landmarks.v039");
  }, legacy);
  await page.setViewportSize({ width: 780, height: 1050 });
  await page.reload();
  const migrated = await state(page);
  expect(migrated.curves).toEqual([]);
  expect(migrated.landmarks).toEqual(legacy.landmarks);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("contour.landmarks.v02")!),
    ),
  ).toEqual(legacy);
  await create(page, "右眉头点", "右眉尾点");
  expect((await state(page)).curves.length).toBe(2);
  await expect(page.getByTestId("curve-current")).toBeVisible();
  await expect(page.locator(".landmark-actions")).toHaveCount(0);
});

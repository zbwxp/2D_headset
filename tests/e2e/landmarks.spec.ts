import {selectSidebar} from "../helpers/sidebar";
import { test, expect, Page } from "@playwright/test";
const state = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("contour.landmarks.v039")!),
  );
async function choose(page: Page, name: string) {
  await selectSidebar(page,"landmark",name);
}
async function view(page: Page, name: string) {
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name, exact: true })
    .click();
}
async function drag(page: Page, name: string, dx: number, dy: number) {
  const b = await page.getByTestId(`landmark-${name}`).boundingBox();
  if (!b) throw Error("missing");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 8,
  });
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建", exact: true }).click();
});
test("cross-view same point, whole-view locks, mirror hard constraints, DOF and undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const old = await state(page);
  await choose(page, "左外眼角点");
  await drag(page, "左外眼角点", 30, 20);
  let p = await state(page);
  const find = (p: any, n: string) =>
    p.landmarks.find((x: any) => x.name === n);
  expect(find(p, "左外眼角点").position[2]).toBe(
    find(old, "左外眼角点").position[2],
  );
  expect(find(p, "左外眼角点").position[0]).not.toBe(
    find(old, "左外眼角点").position[0],
  );
  for (const l of old.landmarks)
    if (!["左外眼角点", "右外眼角点"].includes(l.name))
      expect(find(p, l.name)).toEqual(l);
  expect(find(p, "右外眼角点").position).toEqual([
    -find(p, "左外眼角点").position[0],
    ...find(p, "左外眼角点").position.slice(1),
  ]);
  await page.getByLabel("锁定此视图全部点").check();
  await choose(page, "左眉尾点");
  await expect(page.getByLabel("锁定此视图全部点")).toBeChecked();
  await choose(page, "左外眼角点");
  await expect(page.getByLabel("锁定此视图全部点")).toBeChecked();
  await view(page, "侧面");
  await expect(page.getByTestId("allowed-track")).toHaveCount(1);
  const before = find(await state(page), "左外眼角点").position;
  await drag(page, "左外眼角点", 40, 30);
  const after = find(await state(page), "左外眼角点").position;
  expect(after[0]).toBe(before[0]);
  expect(after[1]).toBe(before[1]);
  expect(after[2]).not.toBe(before[2]);
  await page.getByLabel("锁定此视图全部点").check();
  await view(page, "右 45°");
  await expect(page.getByTestId("dof")).toHaveText("0 DOF");
  await drag(page, "左外眼角点", 30, 30);
  expect(find(await state(page), "左外眼角点").position).toEqual(after);
  await expect(page.getByRole("status")).toContainText("解除");
  await view(page, "正面");
  await page.getByLabel("锁定此视图全部点").uncheck();
  await expect(page.getByTestId("dof")).toHaveText("1 DOF");
  await choose(page, "右外眼角点");
  await expect(page.getByTestId("dof")).toHaveText("1 DOF");
  await choose(page, "鼻尖点");
  await view(page, "侧面");
  await page.getByLabel("锁定此视图全部点").check();
  await expect(page.getByTestId("dof")).toHaveText("0 DOF");
  await page.reload();
  await choose(page, "鼻尖点");
  await view(page, "侧面");
  await expect(page.getByLabel("锁定此视图全部点")).toBeChecked();
  expect(errors).toEqual([]);
});
test("reference transforms preserve point locks; history and save/load roundtrip", async ({
  page,
}, info) => {
  await choose(page, "左外眼角点");
  await page.getByLabel("锁定此视图全部点").check();
  const initial = await state(page);
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 320;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#aaa090";
    ctx.fillRect(0, 0, 240, 320);
    ctx.fillStyle = "#292c2d";
    ctx.fillRect(50, 120, 140, 5);
    return c.toDataURL().split(",")[1];
  });
  await page.getByTestId("reference-input").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
  await expect(page.getByTestId("reference-image")).toBeVisible();
  for (const label of ["透明度", "图片缩放", "旋转"]) {
    await page.getByLabel(label, { exact: true }).focus();
    await page.keyboard.press("ArrowRight");
  }
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "opacity",
    "0.4525",
  );
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "transform",
    /rotate\(0.9\) scale\(1.01225\)/,
  );
  await page.getByRole("button", { name: "平移图片", exact: true }).click();
  const b = await page.getByTestId("point-editor").boundingBox();
  await page.mouse.move(b!.x + 30, b!.y + 150);
  await page.mouse.down();
  await page.mouse.move(b!.x + 60, b!.y + 180);
  await page.mouse.up();
  await page.getByRole("button", { name: "完成图片平移" }).click();
  await page.getByRole("button", { name: "锁定参考图", exact: true }).click();
  await expect(page.getByLabel("图片缩放", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "关闭参考照片设置" }).click();
  await page.getByTestId("point-editor").hover();
  await page.mouse.wheel(0, -200);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await state(page)).landmarks).toEqual(initial.landmarks);
  await page.getByRole("button", { name: "保存 JSON" }).click();
  await page.reload();
  await expect(page.getByTestId("reference-image")).toBeVisible();
  expect((await state(page)).landmarks).toEqual(initial.landmarks);
  await page.screenshot({ path: info.outputPath("point-editor.png") });
  await page.getByRole("button", { name: "解锁正面全部点" }).click();
  await choose(page, "左眉尾点");
  await page.getByTestId("landmark-左眉尾点").focus();
  const before = (await state(page)).landmarks;
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowUp");
  for (let i = 0; i < 12; i++) await page.keyboard.press("Control+z");
  expect((await state(page)).landmarks).toEqual(before);
  const saved = await state(page);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "roundtrip.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await expect
    .poll(async () => (await state(page)).landmarks)
    .toEqual(saved.landmarks);
});

test("front global lock survives selecting every point in right45; clicking never edits or adds history", async ({
  page,
}, info) => {
  await page.getByLabel("锁定此视图全部点").check();
  await view(page, "右 45°");
  const before = await state(page),
    history = await page.locator(".point-footer").innerText();
  for (const l of before.landmarks) {
    await choose(page, l.name);
    await page.getByTestId(`landmark-${l.name}`).click();
    expect((await state(page)).landmarks.map((l: any) => l.position)).toEqual(
      before.landmarks.map((l: any) => l.position),
    );
    await expect(
      page.getByRole("button", { name: "解锁正面全部点" }),
    ).toBeVisible();
  }
  expect(
    (await page.locator(".point-footer").innerText()).split("撤销")[1],
  ).toBe(history.split("撤销")[1]);
  await choose(page, "颅顶点");
  await page.screenshot({ path: info.outputPath("global-lock-midline.png") });
  await expect(page.getByTestId("centerline-guide")).toHaveAttribute(
    "stroke-dasharray",
    "3 5",
  );
  await page.getByRole("button", { name: "解锁正面全部点" }).click();
  expect(
    (await state(page)).landmarks.every((l: any) => !l.viewLocks.front),
  ).toBe(true);
  await page.keyboard.press("Control+z");
  expect((await state(page)).landmarks.map((l: any) => l.position)).toEqual(
    before.landmarks.map((l: any) => l.position),
  );
});
test("both 45 degree edits keep world mirror and every globally locked front projection", async ({
  page,
}) => {
  await choose(page, "左外眼角点");
  await page.getByLabel("锁定此视图全部点").check();
  const before = await state(page);
  for (const name of ["左 45°", "右 45°"]) {
    await view(page, name);
    await drag(page, "左外眼角点", 18, 12);
    const p = await state(page),
      l = p.landmarks.find((l: any) => l.name === "左外眼角点");
    const partner = p.landmarks.find((x: any) => x.id === l.mirrorPartnerId);
    expect(partner.position).toEqual([
      -l.position[0],
      l.position[1],
      l.position[2],
    ]);
    for (let i = 0; i < p.landmarks.length; i++)
      expect(p.landmarks[i].position.slice(0, 2)).toEqual(
        before.landmarks[i].position.slice(0, 2),
      );
  }
});

test("right eye driver: yaw45 -> top diagonal, follower moves, handoff, undo and second lock", async ({
  page,
}, info) => {
  await choose(page, "右外眼角点");
  await view(page, "右 45°");
  await page.getByLabel("锁定此视图全部点").check();
  await expect(page.getByTestId("dof")).toHaveText("1 DOF");
  await expect(page.getByTestId("allowed-track")).toHaveCount(0);
  await view(page, "纯俯视");
  await expect(page.getByTestId("allowed-track")).toHaveCount(1);
  const before = await state(page),
    get = (p: any, n: string) => p.landmarks.find((l: any) => l.name === n);
  await drag(page, "右外眼角点", 30, 30);
  const after = await state(page),
    a = get(before, "右外眼角点").position,
    b = get(after, "右外眼角点").position;
  expect(b[0] - a[0]).toBeCloseTo(b[2] - a[2], 9);
  expect(Math.abs(b[0] - a[0])).toBeGreaterThan(0.02);
  expect(b[1]).toBe(a[1]);
  expect(get(after, "左外眼角点").position).toEqual([-b[0], b[1], b[2]]);
  expect(get(after, "左外眼角点").viewLocks).toEqual({});
  await page.screenshot({ path: info.outputPath("driver-top-diagonal.png") });
  await page.keyboard.press("Control+z");
  expect(get(await state(page), "右外眼角点").position).toEqual(a);
  await page.keyboard.press("Control+Shift+z");
  expect(get(await state(page), "右外眼角点").position).toEqual(b);
  await choose(page, "左外眼角点");
  await expect(page.getByTestId("dof")).toHaveText("1 DOF");
  const swapped = await state(page);
  expect(get(swapped, "右外眼角点").viewLocks).toEqual({});
  expect(get(swapped, "左外眼角点").viewLocks.right45).toBeTruthy();
  await page.reload();
  await choose(page, "左外眼角点");
  await view(page, "纯俯视");
  await expect(page.getByTestId("dof")).toHaveText("1 DOF");
  await page.getByLabel("锁定此视图全部点").check();
  await expect(page.getByTestId("dof")).toHaveText("0 DOF");
});

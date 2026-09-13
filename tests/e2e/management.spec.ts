import { test, expect, Page } from "@playwright/test";
const state = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("contour.landmarks.v039")!));
async function choose(p: Page, n: string) {
  await p
    .locator(".point-list")
    .getByRole("button", { name: n, exact: true })
    .click();
}
async function action(p: Page, label: string, name?: string) {
  if (label === "重命名") {
    await p.locator(".point-list .active .entity-name").dblclick();
    await p.getByLabel("语义点名称").fill(name!);
    await p.getByLabel("语义点名称").press("Enter");
  } else {
    await p.locator(".point-workspace").focus();
    await p.keyboard.press(label === "复制" ? "Control+c" : "Delete");
    if (label === "复制") {
      await p.getByLabel("语义点名称").fill(name!);
      await p
        .getByRole("region", { name: "复制语义点", exact: true })
        .getByRole("button", { name: "复制", exact: true })
        .click();
    } else
      await p
        .getByRole("dialog")
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
  }
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建", exact: true }).click();
});
test("management and existing history: copy centers/pairs, rename presets, delete/restore exact UUIDs and anchors", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await choose(page, "鼻尖点");
  await action(page, "复制", "测试中心点");
  let p = await state(page);
  const copied = p.landmarks.at(-1);
  expect(copied.name).toBe("测试中心点");
  await page.keyboard.press("Control+z");
  expect(
    (await state(page)).landmarks.some((l: any) => l.id === copied.id),
  ).toBe(false);
  await page.keyboard.press("Control+Shift+z");
  expect((await state(page)).landmarks.at(-1)).toEqual(copied);
  await choose(page, "测试中心点");
  await expect(page.locator(".point-detail strong")).toHaveText("测试中心点");
  await page.getByTestId("landmark-测试中心点").focus();
  await page.keyboard.press("ArrowUp");
  p = await state(page);
  expect(
    p.landmarks.find((l: any) => l.name === "鼻尖点").position,
  ).not.toEqual(p.landmarks.at(-1).position);
  await choose(page, "右外眼角点");
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name: "右 45°", exact: true })
    .click();
  await page.getByLabel("锁定此视图全部点").check();
  await action(page, "复制", "颧骨点");
  await expect(page.locator(".point-detail strong")).toHaveText("右颧骨点");
  await expect(page.getByTestId("dof")).toHaveText("1 DOF");
  await page
    .locator(".point-view-tabs")
    .getByRole("button", { name: "纯俯视", exact: true })
    .click();
  await expect(page.getByTestId("allowed-track")).toHaveCount(1);
  const beforeMove = await state(page);
  await page.getByTestId("landmark-右颧骨点").focus();
  await page.keyboard.press("ArrowRight");
  p = await state(page);
  expect(p.landmarks.find((l: any) => l.name === "右外眼角点")).toEqual(
    beforeMove.landmarks.find((l: any) => l.name === "右外眼角点"),
  );
  await choose(page, "鼻尖点");
  await action(page, "重命名", "鼻部中心点");
  await page.keyboard.press("Control+z");
  await expect(
    page
      .locator(".point-list")
      .getByRole("button", { name: "鼻尖点", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(
    page
      .locator(".point-list")
      .getByRole("button", { name: "鼻部中心点", exact: true }),
  ).toBeVisible();
  await choose(page, "右颧骨点");
  await action(page, "重命名", "颧骨最高点");
  const beforeDelete = await state(page);
  await action(page, "删除");
  expect(
    (await state(page)).landmarks.some((l: any) =>
      l.name.includes("颧骨最高点"),
    ),
  ).toBe(false);
  await page.keyboard.press("Control+z");
  expect((await state(page)).landmarks).toEqual(beforeDelete.landmarks);
  await page.keyboard.press("Control+Shift+z");
  expect((await state(page)).landmarks.length).toBe(
    beforeDelete.landmarks.length - 2,
  );
  await page.keyboard.press("Control+z");
  const saved = await state(page);
  await page.reload();
  expect((await state(page)).landmarks).toEqual(saved.landmarks);
  await page.screenshot({ path: info.outputPath("management.png") });
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "custom.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await expect
    .poll(async () => (await state(page)).landmarks)
    .toEqual(saved.landmarks);
  expect(errors).toEqual([]);
});
test("empty project remains legal, preserves locks, Undo restores, JSON load supports zero points", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByLabel("锁定此视图全部点").check();
  for (let i = 0; i < 13; i++) await action(page, "删除");
  await expect(page.locator(".point-list [data-landmark-id]")).toHaveCount(0);
  await page.locator(".point-workspace").focus();
  await page.keyboard.press("Control+c");
  await expect(
    page.getByRole("region", { name: "复制语义点", exact: true }),
  ).toHaveCount(0);
  const empty = await state(page);
  expect(empty.lockedViews).toEqual(["front"]);
  await expect(page.getByLabel("锁定此视图全部点")).toBeChecked();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".point-list [data-landmark-id]")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".point-list [data-landmark-id]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".point-list [data-landmark-id]")).toHaveCount(0);
  await expect(page.getByLabel("锁定此视图全部点")).toBeChecked();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "empty.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(empty)),
    });
  await expect(page.locator(".point-list [data-landmark-id]")).toHaveCount(0);
  await page.getByLabel("锁定此视图全部点").uncheck();
  expect((await state(page)).lockedViews).toEqual([]);
  await page.keyboard.press("Control+z");
  expect((await state(page)).lockedViews).toEqual(["front"]);
  expect(errors).toEqual([]);
});

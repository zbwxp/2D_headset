import { test, expect, Page } from "@playwright/test";
const state = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("contour.landmarks.v039")!));
const pick = (p: Page, n: string) =>
  p
    .locator(".point-list")
    .getByRole("button", { name: n, exact: true })
    .click();
const view = (p: Page, n: string) =>
  p
    .locator(".point-view-tabs")
    .getByRole("button", { name: n, exact: true })
    .click();
const heading = (p: Page, n: string) =>
  p.getByRole("region", { name: n, exact: true }).locator(".section-heading");
async function movePanel(p: Page, id: string, dx: number, dy: number) {
  const box = await p.getByTestId(`${id}-header`).boundingBox();
  await p.mouse.move(box!.x + 40, box!.y + 12);
  await p.mouse.down();
  await p.mouse.move(box!.x + 40 + dx, box!.y + 12 + dy, { steps: 8 });
  await p.mouse.up();
}
async function photo(p: Page) {
  const data = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 180;
    return c.toDataURL().split(",")[1];
  });
  await p.getByTestId("reference-input").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建", exact: true }).click();
});
test("duplicate is nonmodal, movable, source-bound; UI context blocks geometry shortcuts", async ({
  page,
}, info) => {
  await pick(page, "鼻尖点");
  const before = await state(page),
    history = await page.locator(".point-footer").innerText();
  await page.keyboard.press("Control+c");
  const panel = page.locator('[data-floating-panel="duplicate"]');
  await expect(panel).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("语义点名称").press("Control+c");
  await page.getByLabel("语义点名称").press("Backspace");
  expect((await state(page)).landmarks).toEqual(before.landmarks);
  await page.getByLabel("语义点名称").fill("绑定鼻尖副本");
  const old = await panel.boundingBox();
  await movePanel(page, "duplicate", -200, 70);
  const moved = await panel.boundingBox();
  expect(moved!.x).not.toBe(old!.x);
  expect(await state(page)).toEqual(before);
  expect(await page.locator(".point-footer").innerText()).toBe(history);
  await panel.getByRole("button", { name: "复制", exact: true }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+c");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await view(page, "右 30°");
  await pick(page, "山根点");
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBe(moved!.x);
  await panel.getByRole("button", { name: "复制", exact: true }).click();
  const after = await state(page),
    copy = after.landmarks.find((l: any) => l.name === "绑定鼻尖副本");
  expect(copy.position).toEqual(
    before.landmarks.find((l: any) => l.name === "鼻尖点").position,
  );
  await page.keyboard.press("Control+c");
  expect((await panel.boundingBox())!.x).toBe(moved!.x);
  await page.setViewportSize({ width: 650, height: 720 });
  await expect
    .poll(async () => {
      const b = await panel.boundingBox();
      return (
        b!.x >= 0 &&
        b!.y >= 0 &&
        b!.x + b!.width <= 650 &&
        b!.y + b!.height <= 720
      );
    })
    .toBe(true);
  await page.screenshot({ path: info.outputPath("floating-duplicate.png") });
  await page.getByLabel("语义点名称").press("Escape");
  await expect(panel).toHaveCount(0);
});
test("inline names, context menu, collapse retain selection and delete only active curve", async ({
  page,
}) => {
  await pick(page, "右眉尾点");
  const before = await state(page);
  await page.locator(".point-list .active .entity-name").dblclick();
  const input = page.getByLabel("语义点名称");
  await expect(input).toHaveValue("眉尾点");
  await input.fill("新眉尾");
  await input.press("Escape");
  expect((await state(page)).landmarks).toEqual(before.landmarks);
  await page.locator(".point-list .active .entity-name").dblclick();
  await input.fill("眉尾改名");
  await input.press("Enter");
  const renamed = await state(page);
  expect(
    renamed.landmarks.filter((l: any) => l.name.includes("眉尾改名")).length,
  ).toBe(2);
  expect(renamed.landmarks.map((l: any) => l.position)).toEqual(
    before.landmarks.map((l: any) => l.position),
  );
  await page.locator(".point-list .active").click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await input.fill("右基础");
  await heading(page, "结构线").click();
  expect(
    (await state(page)).landmarks.some((l: any) => l.name === "右右基础"),
  ).toBe(true);
  await heading(page, "结构线").click();
  await page.getByRole("button", { name: "创建曲线", exact: true }).click();
  await pick(page, "右眉头点");
  await pick(page, "右右基础");
  const curves = await state(page);
  const name = curves.curves[0].name;
  await page.locator(".point-workspace").focus();
  await page.keyboard.press("Meta+c");
  await expect(page.locator('[data-floating-panel="duplicate"]')).toHaveCount(
    0,
  );
  const hist = await page.locator(".point-footer").innerText();
  await heading(page, "结构线").click();
  await heading(page, "语义点").click();
  expect(await page.locator(".point-footer").innerText()).toBe(hist);
  await expect(page.locator(".point-footer")).toContainText(name);
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog")).toHaveAttribute(
    "aria-label",
    "删除结构线",
  );
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  expect((await state(page)).curves).toEqual([]);
  expect((await state(page)).landmarks).toEqual(curves.landmarks);
});
test("reference inspector stays open and stationary across views without transform changes", async ({
  page,
}, info) => {
  await photo(page);
  const panel = page.locator('[data-floating-panel="reference"]');
  await expect(panel).toBeVisible();
  await movePanel(page, "reference", 500, 70);
  const pos = await panel.boundingBox(),
    before = await state(page);
  await view(page, "右 30°");
  await expect(panel).toContainText("当前视图没有参考图");
  expect((await panel.boundingBox())!.x).toBe(pos!.x);
  expect((await panel.boundingBox())!.y).toBe(pos!.y);
  await view(page, "正面");
  expect(await state(page)).toEqual(before);
  await page.getByRole("slider", { name: "透明度", exact: true }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Meta+c");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-floating-panel="duplicate"]')).toHaveCount(
    0,
  );
  expect(await state(page)).toEqual(before);
  await page
    .getByRole("slider", { name: "透明度", exact: true })
    .press("ArrowRight");
  expect((await state(page)).views[0].reference.opacity).toBe(0.4525);
  await heading(page, "语义点").click();
  await expect(panel).toBeVisible();
  await page.screenshot({ path: info.outputPath("reference-ui.png") });
  await page
    .getByRole("button", { name: "关闭参考照片设置", exact: true })
    .click();
  await expect(page.getByTestId("reference-image")).toBeVisible();
});
test("long curve list scroll leaves plane controls fixed and visible", async ({
  page,
}) => {
  await page.getByRole("button", { name: "创建曲线", exact: true }).click();
  await pick(page, "右眉头点");
  await pick(page, "右眉尾点");
  const original = await state(page),
    p = structuredClone(original);
  for (let i = 0; i < 50; i++) {
    const a = structuredClone(original.curves[0]),
      b = structuredClone(original.curves[1]);
    a.id = crypto.randomUUID();
    b.id = crypto.randomUUID();
    a.mirrorPartnerCurveId = b.id;
    b.mirrorPartnerCurveId = a.id;
    b.canonicalCurveId = a.id;
    a.name = `右线${i}`;
    b.name = `左线${i}`;
    p.curves.push(a, b);
  }
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "long.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await page
    .locator(".curve-list")
    .getByRole("button", { name: "右线0", exact: true })
    .click();
  const box = await page.getByTestId("curve-current").boundingBox();
  await page.locator(".curve-list").hover();
  await page.mouse.wheel(0, 1500);
  await expect(
    page.getByRole("slider", { name: "调整曲线平面" }),
  ).toBeVisible();
  expect(await page.getByTestId("curve-current").boundingBox()).toEqual(box);
  expect((await state(page)).curves).toEqual(p.curves);
});

test("rename keeps workspace focus; cancelled or unchanged edits add no history", async ({
  page,
}) => {
  await pick(page, "鼻尖点");
  const p = await state(page),
    footer = await page.locator(".point-footer").innerText();
  await page.locator(".point-list .active .entity-name").dblclick();
  await page.getByLabel("语义点名称").press("Enter");
  // Inline rename restores row focus on the next animation frame.
  await expect(page.locator(".point-list .active[role=button]")).toBeFocused();
  expect(await page.locator(".point-footer").innerText()).toBe(footer);
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(await state(page)).toEqual(p);
  await page.keyboard.press("Meta+c");
  await expect(page.locator('[data-floating-panel="duplicate"]')).toBeVisible();
  await page.getByLabel("语义点名称").press("Escape");
  expect(await state(page)).toEqual(p);
});

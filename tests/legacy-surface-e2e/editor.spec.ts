import { test, expect, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function settled(page: Page) {
  await expect(
    page.getByRole("button", { name: "精细求解 REFINE" }),
  ).toBeEnabled({ timeout: 20000 });
}
async function dragHandle(page: Page, index: number, dx: number, dy: number) {
  const h = page.getByTestId(`handle-${index}`);
  const box = await h.boundingBox();
  if (!box) throw new Error("Handle missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + dx,
    box.y + box.height / 2 + dy,
    { steps: 5 },
  );
  await page.mouse.up();
  await settled(page);
}
test("default load, live editing, lock, side edit, undo, save/load and OBJ export", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "语义头部曲面" }),
  ).toBeVisible();
  await expect(page.locator(".webgl-host canvas")).toBeVisible();
  await expect(page.getByTestId("target-curve")).toHaveAttribute("d", /M /);
  await page.screenshot({ path: info.outputPath("01-default.png") });
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  const before = await page.getByTestId("target-curve").getAttribute("d");
  await dragHandle(page, 0, 12, 5);
  const edited = await page.getByTestId("target-curve").getAttribute("d");
  expect(edited).not.toBe(before);
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "锁定视角", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解锁视角", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "侧面", exact: true }).click();
  await page.getByRole("button", { name: "颅顶 Cranial 1" }).click();
  await dragHandle(page, 8, -8, 0);
  await page.getByRole("button", { name: "精细求解 REFINE" }).click();
  await settled(page);
  await page.screenshot({ path: info.outputPath("02-side-edit.png") });
  await page.getByRole("button", { name: "线框", exact: true }).click();
  await page.screenshot({ path: info.outputPath("03-wireframe.png") });
  await page.getByRole("button", { name: "线框", exact: true }).click();
  await page.getByRole("tab", { name: "正面", exact: true }).click();
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  expect(await page.getByTestId("target-curve").getAttribute("d")).toBe(edited);
  await page.screenshot({ path: info.outputPath("04-locked-front.png") });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const download = await downloadPromise;
  const json = await readFile((await download.path())!, "utf8");
  const saved = JSON.parse(json);
  expect(
    saved.constraints.find((c: any) => c.id === "front:jaw_ring").userAuthored,
  ).toBe(true);
  expect(saved.views.find((v: any) => v.id === "front").locked).toBe(true);
  expect(saved.surface.vertices.length).toBe(994);
  const objPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 OBJ", exact: true }).click();
  const obj = await objPromise;
  const content = await readFile((await obj.path())!, "utf8");
  expect(content.match(/^v /gm)).toHaveLength(994);
  expect(content).not.toMatch(/NaN|Infinity/);
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "锁定视角", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解锁视角", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "锁定视角", exact: true }),
  ).toBeVisible();
  await page
    .locator("input[type=file]:not([data-testid=reference-input])")
    .setInputFiles({
      name: "roundtrip.json",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  await expect(
    page.getByRole("button", { name: "解锁视角", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "解锁视角", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("point editing, modes, malformed import, mobile layout and snapshots", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const count = await page.locator("[data-testid^=handle-]").count();
  await page.getByRole("button", { name: "添加控制点", exact: true }).click();
  await settled(page);
  expect(await page.locator("[data-testid^=handle-]").count()).toBe(count + 1);
  await page.getByRole("button", { name: "删除控制点", exact: true }).click();
  await settled(page);
  expect(await page.locator("[data-testid^=handle-]").count()).toBe(count);
  await page.getByRole("button", { name: "锁定", exact: true }).click();
  await settled(page);
  await expect(
    page.getByRole("button", { name: "添加控制点", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "强", exact: true }).click();
  await settled(page);
  await page.getByLabel("启用当前约束").uncheck();
  await settled(page);
  await expect(
    page.getByRole("button", { name: "添加控制点", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("启用当前约束").check();
  await settled(page);
  await page.getByLabel("三维显示材质").selectOption("normal");
  await page.screenshot({ path: info.outputPath("05-normal.png") });
  await page.getByLabel("三维显示材质").selectOption("curvature");
  await page.screenshot({ path: info.outputPath("06-curvature.png") });
  await page.getByLabel("三维显示材质").selectOption("clay");
  await page.getByText("显示偏差", { exact: true }).click();
  await page.getByRole("tab", { name: "左 45°", exact: true }).click();
  await page.screenshot({ path: info.outputPath("07-diagonal-errors.png") });
  await page
    .locator("input[type=file]:not([data-testid=reference-input])")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
  await expect(page.getByRole("status")).toContainText("项目格式无效");
  await expect(page.getByTestId("edit-canvas")).toBeVisible();
  await page.getByRole("button", { name: "关闭提示" }).click();
  await page.getByRole("button", { name: "操作指南" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "保存项目", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("08-mobile.png"),
    fullPage: true,
  });
});
test("view transforms persist independently and stale solves cannot overwrite undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "放大二维视图", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("110%");
  await page.getByRole("tab", { name: "侧面", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("100%");
  await page.getByRole("tab", { name: "正面", exact: true }).click();
  await expect(page.locator(".zoom-controls")).toContainText("110%");
  await page.getByRole("button", { name: "重置二维视图", exact: true }).click();
  const before = await page.getByTestId("target-curve").getAttribute("d");
  const h = await page.getByTestId("handle-16").boundingBox();
  if (!h) throw new Error("Handle missing");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 20, h.y, { steps: 3 });
  await page.mouse.up();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.waitForTimeout(700);
  expect(await page.getByTestId("target-curve").getAttribute("d")).toBe(before);
});
test("records browser interaction latency and rendering cadence", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const registry = new Map();
    Object.assign(window, { __modelTools: registry });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(tool: any, options: any) {
          registry.set(tool.name, tool);
          options.signal.addEventListener("abort", () =>
            registry.delete(tool.name),
          );
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  await page.evaluate(() => {
    const record = {
      last: 0,
      inputs: [] as number[],
      frames: [] as number[],
      running: true,
    };
    Object.assign(window, { __perf: record });
    document.querySelector("[data-testid=edit-canvas]")!.addEventListener(
      "pointermove",
      () => {
        record.last = performance.now();
      },
      true,
    );
    new MutationObserver(() => {
      if (record.last) {
        record.inputs.push(performance.now() - record.last);
        record.last = 0;
      }
    }).observe(document.querySelector("[data-testid=target-curve]")!, {
      attributes: true,
      attributeFilter: ["d"],
    });
    let last = performance.now();
    const frame = (now: number) => {
      record.frames.push(now - last);
      last = now;
      if (record.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const h = await page.getByTestId("handle-0").boundingBox();
  if (!h) throw new Error("Missing handle");
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 24, h.y + 8, { steps: 20 });
  await page.mouse.up();
  await settled(page);
  await page.waitForTimeout(300);
  const metrics = await page.evaluate(async () => {
    const r = (window as any).__perf;
    r.running = false;
    const s = (window as any).__modelTools
      .get("read_surface_diagnostics")
      .execute({});
    const sorted = r.inputs.sort((a: number, b: number) => a - b);
    return {
      inputSamples: sorted.length,
      inputMeanMs:
        sorted.reduce((a: number, b: number) => a + b, 0) / sorted.length,
      inputP95Ms: sorted[Math.floor(sorted.length * 0.95)],
      frameMeanMs:
        r.frames.reduce((a: number, b: number) => a + b, 0) / r.frames.length,
      refineMs: s.diagnostics.solveTimeMs,
      centroidDrift: s.diagnostics.centroidDrift,
      symmetryEnergy: s.diagnostics.symmetryEnergy,
    };
  });
  await info.attach("performance.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  console.log("BROWSER_METRICS", JSON.stringify(metrics));
  expect(metrics.inputSamples).toBeGreaterThan(0);
  expect(metrics.symmetryEnergy).toBeLessThan(1e-12);
  expect(metrics.refineMs).toBeGreaterThan(0);
  expect(metrics.refineMs).toBeLessThan(500);
});

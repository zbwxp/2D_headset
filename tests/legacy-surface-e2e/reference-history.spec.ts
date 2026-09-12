import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function settle(page: any) {
  await expect(
    page.getByRole("button", { name: "精细求解 REFINE" }),
  ).toBeEnabled({ timeout: 20000 });
}
test("per-view reference import, drag, opacity, scale, lock and project round trip", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 320;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#c7b499";
    ctx.fillRect(0, 0, 240, 320);
    ctx.fillStyle = "#55483a";
    ctx.fillRect(30, 30, 180, 260);
    ctx.strokeStyle = "#e0d4b4";
    ctx.lineWidth = 2;
    for (let y = 0; y < 320; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(240, y);
      ctx.stroke();
    }
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByTestId("reference-input").setInputFiles({
    name: "alignment.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByTestId("reference-image")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "参考照片设置" }),
  ).toBeVisible();
  await page.getByLabel("透明度", { exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "opacity",
    "0.5",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "opacity",
    "0.45",
  );
  await page.getByLabel("图片缩放", { exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "transform",
    /scale\(1.05\)/,
  );
  const curve = await page.getByTestId("target-curve").getAttribute("d");
  await page.getByRole("button", { name: "平移图片", exact: true }).click();
  const canvas = await page.getByTestId("edit-canvas").boundingBox();
  if (!canvas) throw new Error("Canvas missing");
  await page.mouse.move(canvas.x + 60, canvas.y + 150);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 90, canvas.y + 180, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "完成定位", exact: true }).click();
  const transform = await page
    .getByTestId("reference-image")
    .getAttribute("transform");
  expect(transform).not.toContain("translate(0 0)");
  expect(await page.getByTestId("target-curve").getAttribute("d")).toBe(curve);
  await page.getByRole("button", { name: "参考图设置", exact: true }).click();
  await page.getByRole("button", { name: "锁定参考图", exact: true }).click();
  await expect(page.getByLabel("图片缩放", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "平移图片", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("reference-locked.png") });
  await page.getByRole("button", { name: "关闭参考图设置" }).click();
  await page.getByRole("tab", { name: "侧面", exact: true }).click();
  await expect(page.getByTestId("reference-image")).toHaveCount(0);
  await page.getByRole("tab", { name: "正面", exact: true }).click();
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "transform",
    transform!,
  );
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const json = await readFile((await (await dl).path())!, "utf8");
  const saved = JSON.parse(json);
  expect(saved.views[0].reference.locked).toBe(true);
  expect(saved.views[0].reference.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "transform",
    transform!,
  );
  await page.getByRole("button", { name: "参考图设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "解锁参考图" })).toBeVisible();
  await page.getByRole("button", { name: "解锁参考图" }).click();
  await page.getByRole("button", { name: "移除参考照片" }).click();
  await expect(page.getByTestId("reference-image")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByTestId("reference-image")).toBeVisible();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page
    .locator("input[type=file]:not([data-testid=reference-input])")
    .setInputFiles({
      name: "ref.json",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  await expect(page.getByTestId("reference-image")).toHaveAttribute(
    "transform",
    transform!,
  );
});
test("40 distinct edits can all be undone and redone with Ctrl Z", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  const first = page.getByTestId("handle-0");
  await first.focus();
  const states = [await page.getByTestId("target-curve").getAttribute("d")];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("ArrowDown");
    await settle(page);
    states.push(await page.getByTestId("target-curve").getAttribute("d"));
  }
  expect(new Set(states).size).toBe(41);
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toHaveAttribute("title", /剩余 41 步/);
  for (let i = 39; i >= 0; i--) {
    await page.keyboard.press("Control+z");
    expect(await page.getByTestId("target-curve").getAttribute("d")).toBe(
      states[i],
    );
  }
  for (let i = 1; i <= 40; i++) {
    await page.keyboard.press("Control+Shift+z");
    expect(await page.getByTestId("target-curve").getAttribute("d")).toBe(
      states[i],
    );
  }
});
test("sparse silhouette handles keep old targets and invalid photos leave project intact", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const n = await page.locator("[data-testid^=handle-]").count();
  expect(n).toBeLessThanOrEqual(28);
  expect(n).toBeGreaterThanOrEqual(24);
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  expect(await page.locator("[data-testid^=handle-]").count()).toBe(3);
  await page.getByRole("button", { name: "添加控制点", exact: true }).click();
  await settle(page);
  expect(await page.locator("[data-testid^=handle-]").count()).toBe(4);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const json = await readFile((await (await download).path())!, "utf8");
  const curve = JSON.parse(json).constraints.find(
    (c: any) => c.id === "front:jaw_ring",
  ).curve;
  expect(new Set(curve.parameters).size).toBe(curve.parameters.length);
  await page
    .locator("input[type=file]:not([data-testid=reference-input])")
    .setInputFiles({
      name: "added-point.json",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  expect(await page.locator("[data-testid^=handle-]").count()).toBe(4);
  const target = await page.getByTestId("target-curve").getAttribute("d");
  await page.getByTestId("reference-input").setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("status")).toContainText("无法读取");
  expect(await page.getByTestId("target-curve").getAttribute("d")).toBe(target);
});

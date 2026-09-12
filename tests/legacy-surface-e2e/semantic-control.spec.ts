import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function settle(page: any) {
  await expect(
    page.getByRole("button", { name: "精细求解 REFINE" }),
  ).toBeEnabled({ timeout: 20000 });
}
test("collinear visible brow controls produce a straight complete target and solved ring", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "眉弓 Brow 2" }).click();
  await page.getByTestId("handle-8").focus();
  await page.keyboard.press("ArrowUp");
  await settle(page);
  await page.getByTestId("handle-0").focus();
  await page.keyboard.press("ArrowUp");
  await settle(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const p = JSON.parse(
      await readFile((await (await download).path())!, "utf8"),
    ),
    c = p.constraints.find((c: any) => c.id === "front:brow_ring");
  const ys = c.curve.points.map((q: number[]) => q[1]);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-8);
  const ring = p.semanticModel.rings.find((r: any) => r.id === "brow_ring"),
    solved = ring.samples.map((s: any) => p.surface.vertices[s.vertexId][1]);
  expect(Math.max(...solved) - Math.min(...solved)).toBeLessThan(0.006);
  await page.screenshot({ path: info.outputPath("straight-brow.png") });
  expect(errors).toEqual([]);
});
test("face meridian remains highlighted in every view and with other rings hidden", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "语义线", exact: true }).click();
  let front = "",
    diagonal = "";
  for (const label of [
    "正面",
    "左 45°",
    "右 45°",
    "侧面",
    "俯 45°",
    "仰 45°",
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    const line = page.getByTestId("front-midline");
    await expect(line).toHaveCSS("stroke", "rgb(255, 200, 121)");
    expect(
      await line.evaluate((el: SVGPathElement) => el.getTotalLength()),
    ).toBeGreaterThan(200);
    await expect(page.getByTestId("edit-canvas")).toBeVisible();
    const d = await line.getAttribute("d");
    expect(d).not.toMatch(/Z$/);
    if (label === "正面") front = d!;
    if (label === "右 45°") {
      diagonal = d!;
      await page.screenshot({ path: info.outputPath("right45-midline.png") });
    }
  }
  expect(front).not.toBe(diagonal);
  await page.getByRole("button", { name: "正中线 Midline 8" }).click();
  expect(await page.locator("[data-testid^=handle-]").count()).toBe(0);
  await expect(
    page.getByRole("button", { name: "添加控制点", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText("固定面部经线 · 只读")).toBeVisible();
});

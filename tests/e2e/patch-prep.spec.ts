import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { controls } from "../../src/domain/curves/geometry";
import { project } from "../../src/domain/geometry/core";
const prepared = JSON.parse(
  readFileSync("artifacts/patch-prep/cheek-cage.json", "utf8"),
);
const state = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("contour.landmarks.v039")!));
async function load(page: Page, data: any) {
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "patch-prep.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});
test("old Smooth is ignored; all 2D and thumbnail paths equal exact source; no inspector or fairing", async ({
  page,
}) => {
  await load(page, {
    ...prepared,
    smoothJunctions: "invalid",
    surfaceSmoothNodes: { enabled: true, extent: 0.45 },
    surfaceSmoothDefaults: { enabled: true },
  });
  const p = await state(page);
  expect(p.smoothJunctions).toBeUndefined();
  expect(p.surfaceSmoothNodes).toBeUndefined();
  await expect(page.locator('[data-testid^="blend-"]')).toHaveCount(0);
  await page.getByTestId("landmark-左颊峰点").click({ button: "right" });
  await page.getByTestId("landmark-左颊峰点").dblclick();
  await expect(page.getByRole("region", { name: /Smooth/ })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "平滑范围" })).toHaveCount(0);
  for (const c of p.curves) {
    const cp = controls(p, c),
      view = p.views.find((v: any) => v.id === "front"),
      xy = cp.map((q) => {
        const a = project(q, view);
        return `${a[0] * 160},${-a[1] * 160}`;
      });
    await expect(page.getByTestId(`curve-hit-${c.id}`)).toHaveAttribute(
      "d",
      `M${xy[0]} C${xy[1]} ${xy[2]} ${xy[3]}`,
    );
  }
  for (const c of p.curves) {
    const rendered = page.getByTestId(`curve-${c.id}`);
    await expect(rendered).toHaveCount(4);
    for (const [i, id] of ["front", "front", "left45", "side"].entries()) {
      const view = p.views.find((v: any) => v.id === id),
        xy = controls(p, c).map((q) => {
          const v = project(q, view);
          return `${v[0] * 160},${-v[1] * 160}`;
        });
      await expect(rendered.nth(i)).toHaveAttribute(
        "d",
        `M${xy[0]} C${xy[1]} ${xy[2]} ${xy[3]}`,
      );
    }
  }
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存 JSON", exact: true }).click();
  const stream = await (await dl).createReadStream();
  let text = "";
  for await (const c of stream!) text += c.toString();
  expect(text).not.toMatch(/surfaceSmooth|smoothJunctions/);
  await load(page, JSON.parse(text));
  expect((await state(page)).curves).toEqual(p.curves);
});
test("cheek is editable with ordinary mirror and history; inspect all requested views", async ({
  page,
}, info) => {
  await load(page, prepared);
  await page
    .getByRole("region", { name: "左右对称点", exact: true })
    .getByRole("button", { name: "左颊峰点", exact: true })
    .click();
  const before = await state(page);
  const b = await page.getByTestId("landmark-左颊峰点").boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + 15, b!.y - 8, { steps: 5 });
  await page.mouse.up();
  const after = await state(page),
    l = after.landmarks.find((l: any) => l.name === "左颊峰点"),
    r = after.landmarks.find((l: any) => l.name === "右颊峰点");
  expect(l.position).not.toEqual(
    before.landmarks.find((old: any) => old.id === l.id)!.position,
  );
  expect(r.position).toEqual([-l.position[0], l.position[1], l.position[2]]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state(page)).landmarks).toEqual(before.landmarks);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await state(page)).landmarks).toEqual(after.landmarks);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  for (const [label, id] of [
    ["正面", "front"],
    ["左 30°", "left30"],
    ["右 30°", "right30"],
    ["左 45°", "left45"],
    ["右 45°", "right45"],
    ["侧面", "side"],
  ]) {
    await page
      .locator(".point-view-tabs")
      .getByRole("button", { name: label, exact: true })
      .click();
    await page.screenshot({
      path: info.outputPath(`${id}.png`),
      animations: "disabled",
    });
  }
  await page.reload();
  expect((await state(page)).landmarks).toEqual(before.landmarks);
  expect((await state(page)).curves).toEqual(before.curves);
});

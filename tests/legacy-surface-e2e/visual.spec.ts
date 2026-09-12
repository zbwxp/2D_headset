import { test, expect } from "@playwright/test";
test("fixed-camera visual regression baselines", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(page.locator(".webgl-host canvas")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  for (const [label, file] of [
    ["正面", "front-edit"],
    ["侧面", "side-edit"],
    ["左 45°", "diagonal-edit"],
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(page.locator(".edit-stage")).toHaveScreenshot(`${file}.png`);
  }
  await expect(page.getByTestId("inspect-stage")).toHaveScreenshot(
    "clay-inspect.png",
  );
  await page.getByRole("button", { name: "线框", exact: true }).click();
  await expect(page.getByTestId("inspect-stage")).toHaveScreenshot(
    "wire-inspect.png",
  );
  await page.getByRole("tab", { name: "正面", exact: true }).click();
  await page.getByRole("button", { name: "锁定视角", exact: true }).click();
  await page.getByRole("tab", { name: "侧面", exact: true }).click();
  await page.getByRole("button", { name: "下颌 Jaw 5" }).click();
  const handle = await page.getByTestId("handle-0").boundingBox();
  if (!handle) throw new Error("Missing handle");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y + 45, { steps: 4 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "精细求解 REFINE" }),
  ).toBeEnabled();
  await page.getByText("显示偏差", { exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "侧面", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".warning-banner")).toBeVisible();
  await expect(page.locator(".edit-stage")).toHaveScreenshot(
    "conflict-errors.png",
  );
});
test("optional agent API validates inputs and updates visible state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered = new Map();
    Object.assign(window, { __modelTools: registered });
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool(tool: any, options: any) {
          registered.set(tool.name, tool);
          options.signal.addEventListener("abort", () =>
            registered.delete(tool.name),
          );
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("edit-canvas")).toBeVisible();
  const before = await page.evaluate(() => {
    const tools = (window as any).__modelTools;
    return {
      count: tools.size,
      read: tools.get("read_surface_diagnostics").execute({}),
    };
  });
  expect(before.count).toBe(2);
  expect(before.read.vertices).toBe(994);
  await page.evaluate(() =>
    (window as any).__modelTools
      .get("select_edit_view")
      .execute({ viewId: "side", entityId: "jaw_ring" }),
  );
  await expect(
    page.getByRole("tab", { name: "侧面", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".entity-row.selected")).toContainText("下颌");
  const error = await page.evaluate(() => {
    try {
      (window as any).__modelTools
        .get("select_edit_view")
        .execute({ viewId: "invalid", entityId: "jaw_ring" });
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  });
  expect(error).toContain("Unknown");
  await expect(
    page.getByRole("tab", { name: "侧面", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

import { test, expect } from "@playwright/test";
test("centerline drag order persists without geometry changes, supports history and load", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建", exact: true }).click();
  const state = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("contour.landmarks.v03")!),
    );
  await page.getByLabel("锁定此视图全部点").check();
  const before = await state();
  const group = page.getByRole("region", { name: "中心线点", exact: true });
  await group
    .getByRole("button", { name: "下巴尖点", exact: true })
    .dragTo(group.getByRole("button", { name: "山根点", exact: true }), {
      targetPosition: { x: 30, y: 2 },
    });
  const after = await state();
  expect(after.centerlineOrder).toEqual([
    before.centerlineOrder[0],
    before.centerlineOrder[5],
    ...before.centerlineOrder.slice(1, 5),
  ]);
  expect(after.landmarks).toEqual(before.landmarks);
  expect(after.lockedViews).toEqual(before.lockedViews);
  const guide = await page
    .getByTestId("centerline-guide")
    .getAttribute("points");
  await page.keyboard.press("Control+z");
  expect((await state()).centerlineOrder).toEqual(before.centerlineOrder);
  await page.keyboard.press("Control+Shift+z");
  expect((await state()).centerlineOrder).toEqual(after.centerlineOrder);
  await page.reload();
  expect((await state()).centerlineOrder).toEqual(after.centerlineOrder);
  expect(
    await page.getByTestId("centerline-guide").getAttribute("points"),
  ).toEqual(guide);
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "ordered.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(after)),
    });
  await expect
    .poll(async () => (await state()).centerlineOrder)
    .toEqual(after.centerlineOrder);
  expect(
    await group
      .locator("button")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-landmark-id")),
      ),
  ).toEqual(after.centerlineOrder);
  // Startup migration is persisted even with no interaction.
  await page.evaluate((p) => {
    delete p.centerlineOrder;
    localStorage.setItem("contour.landmarks.v03", JSON.stringify(p));
  }, before);
  await page.reload();
  expect((await state()).centerlineOrder).toEqual(before.centerlineOrder);
});

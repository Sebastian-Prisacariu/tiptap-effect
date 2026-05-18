import { expect, test } from "@playwright/test"

test("mounts exactly one ProseMirror root in StrictMode", async ({ page }) => {
  await page.goto("/")

  const content = page.getByTestId("editor-content")
  await expect(content.locator(".ProseMirror")).toHaveCount(1)
  await expect(page.getByTestId("text")).toHaveText("Hello browser")
  await expect(page.getByTestId("mounted")).toHaveText("true")
})

test("updates derived state through React hooks", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: "Set content" }).click()
  await expect(page.getByTestId("text")).toHaveText("Updated from hook")
  await expect(page.getByTestId("html")).toHaveText("<p>Updated from hook</p>")

  await page.getByRole("button", { name: "Toggle editable" }).click()
  await expect(page.getByTestId("editable")).toHaveText("false")
})

test("releases and reacquires the DOM mount without duplicating nodes", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: "Toggle content" }).click()
  await expect(page.getByTestId("editor-content")).toHaveCount(0)

  await page.getByRole("button", { name: "Toggle content" }).click()
  const content = page.getByTestId("editor-content")
  await expect(content.locator(".ProseMirror")).toHaveCount(1)
  await expect(page.locator(".ProseMirror")).toHaveCount(1)
})

test("rebuilds the editor when provider options change", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: "Rebuild editor" }).click()
  await expect(page.getByTestId("text")).toHaveText("Rebuilt browser")
  await expect(page.locator(".ProseMirror")).toHaveCount(1)
})

// Usage: node scripts/screenshot.mjs <url> <out.png> [--dark] [--mobile] [--full] [--wait=ms] [--click=selector] [--scroll=y] [--load]
import { chromium } from "playwright-core";

const [, , url, out, ...flags] = process.argv;
if (!url || !out) {
  console.error("usage: screenshot.mjs <url> <out.png> [--dark] [--mobile] [--full]");
  process.exit(2);
}
const has = (f) => flags.includes(f);
const opt = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const dark = has("--dark");
const mobile = has("--mobile");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: dark ? "dark" : "light",
  locale: "zh-CN",
});
await ctx.addInitScript((theme) => localStorage.setItem("hcdn-theme", theme), dark ? "dark" : "light");
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: has("--load") ? "load" : "networkidle" });
if (opt("click")) {
  await page.click(opt("click"));
}
if (opt("scroll")) {
  await page.evaluate((y) => window.scrollTo(0, y), Number(opt("scroll")));
}
await page.waitForTimeout(Number(opt("wait") ?? 900));
await page.screenshot({ path: out, fullPage: has("--full") });
await browser.close();
if (errors.length) console.log("page errors:\n" + errors.join("\n"));
console.log("saved", out);

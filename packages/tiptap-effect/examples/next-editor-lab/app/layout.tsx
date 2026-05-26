import type { Metadata } from "next"
import "./styles.css"

export const metadata: Metadata = {
  title: "tiptap-effect Next editor lab",
  description: "A realistic Next.js example app for exercising tiptap-effect.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

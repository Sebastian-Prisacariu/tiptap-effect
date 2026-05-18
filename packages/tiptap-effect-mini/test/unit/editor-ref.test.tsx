import { render } from "@testing-library/react"
import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { useMergedRef } from "../../src/EditorRef"

const MergedRefProbe = React.forwardRef<HTMLDivElement>(function MergedRefProbe(_, ref) {
  const [localRef, setRef] = useMergedRef(ref)
  React.useEffect(() => {
    localRef.current?.setAttribute("data-local-ref", "set")
  }, [localRef])
  return <div data-testid="probe" ref={setRef} />
})

describe("useMergedRef", () => {
  it("updates object refs and local refs", () => {
    const ref = React.createRef<HTMLDivElement>()
    const view = render(<MergedRefProbe ref={ref} />)

    expect(ref.current).toBe(view.getByTestId("probe"))
    expect(ref.current).toHaveAttribute("data-local-ref", "set")

    view.unmount()
    expect(ref.current).toBeNull()
  })

  it("updates callback refs", () => {
    const callback = vi.fn()
    const view = render(<MergedRefProbe ref={callback} />)

    expect(callback).toHaveBeenCalledWith(view.getByTestId("probe"))
    view.unmount()
    expect(callback).toHaveBeenCalledWith(null)
  })
})


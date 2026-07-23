import { render, screen } from "@testing-library/react";
import App from "./App.jsx";

describe("App", () => {
  it("renders waiver heading", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1, name: /waiver & release/i })
    ).toBeInTheDocument();
  });
});

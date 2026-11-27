import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// No StrictMode: its double-mounted effects would create and destroy a WebGL context on the same canvas.
createRoot(document.getElementById("root")!).render(<App />);

# Design System Specification: The Architectural Lab

## 1. Overview & Creative North Star
**Creative North Star: "The Precise Monolith"**

This design system moves away from the cluttered, "dashboard-heavy" look of traditional EdTech. Instead, it adopts the aesthetic of a high-end Integrated Development Environment (IDE) merged with a premium editorial layout. We treat SQL not just as a tool, but as a craft.

The visual language is defined by **Intentional Asymmetry** and **Tonal Depth**. We eschew the "boxy" grid in favor of layered surfaces that feel like a physical stack of translucent glass and heavy slate. The experience should feel like stepping into a focused, quiet laboratory where the only thing that matters is the code and the data.

---

## 2. Colors & Surface Philosophy
The palette is rooted in a deep, midnight spectrum to reduce eye strain during long coding sessions, punctuated by high-frequency accents that signal action and success.

### Surface Hierarchy & The "No-Line" Rule
Traditional 1px borders are strictly prohibited for sectioning. Structural definition must be achieved through **background color shifts**.
- **Base Layer:** `surface` (#131313) is the canvas.
- **Content Sections:** Use `surface_container_low` (#1c1b1b) for large structural areas.
- **Interactive Elements:** Use `surface_container_highest` (#353534) for cards or panels that require immediate focus.
- **The "Glass & Gradient" Rule:** Floating panels (like tooltips or command palettes) should use `surface_container_high` at 80% opacity with a `backdrop-blur` of 12px. Main CTAs should utilize a subtle linear gradient from `primary` (#bac3ff) to `primary_container` (#4453a7) at a 135-degree angle to provide a "jeweled" depth.

---

## 3. Typography
Our typography pairing balances the "Human" (Inter) with the "Machine" (Space Grotesk & Monospace), creating a dialogue between the learner and the engine.

*   **Display & Headlines:** Use `Space Grotesk`. Its geometric quirks provide a "tech-brutalist" character. 
    *   *Scale:* Use `display-lg` (3.5rem) for hero moments and `headline-sm` (1.5rem) for lesson titles.
*   **UI & Navigation:** Use `Inter`. It is the workhorse for clarity.
    *   *Scale:* `title-sm` (1rem) for navigation and `body-md` (0.875rem) for general descriptions.
*   **The Code Layer:** All SQL input and result sets must use a high-quality Monospace font (e.g., JetBrains Mono).
    *   *Intent:* Code should always sit on a `surface_container_lowest` (#0e0e0e) background to simulate a deep terminal.

---

## 4. Elevation & Depth
In this system, "Higher" does not mean "Shadowy"—it means "Brighter."

*   **Tonal Layering:** To lift a card from the background, shift from `surface` to `surface_container`. The change in luminosity provides a more sophisticated "lift" than a drop shadow.
*   **Ambient Shadows:** If a component must float (e.g., a modal), use a highly diffused shadow: `0px 20px 40px rgba(0, 0, 0, 0.4)`. The shadow color should be a tinted version of the surface, never pure black.
*   **The "Ghost Border" Fallback:** For high-density data tables where separation is critical, use the `outline_variant` (#454652) at **15% opacity**. It should be felt, not seen.

---

## 5. Components

### The Split-Pane Editor (The Core)
The IDE is the heart of the platform. Use `surface_container_lowest` for the editor pane and `surface_container` for the results pane. Separate them with a 4px draggable gutter using `surface_bright` (#393939) only on interaction.

### Buttons & CTAs
*   **Primary:** Gradient of `primary` to `primary_container`. Text is `on_primary_fixed` (#00105b). Border radius: `md` (0.375rem).
*   **Secondary/Ghost:** No background. `outline` (#8f909e) at 20% opacity. On hover, transition to `surface_container_highest`.

### Lesson Cards
Forbid divider lines. Use `spacing-8` (1.75rem) to create clear breathing room between the lesson title (`title-lg`) and the metadata (`label-md`). The card background should be `surface_container_low`.

### Status Indicators
*   **Provisioning:** Pulsing `tertiary` (#44d8f1) glow.
*   **Ready/Success:** Solid `secondary` (#66d9cc) with a `secondary_container` soft outer glow.
*   **Error:** `error` (#ffb4ab) text on a `error_container` (#93000a) background.

### Data Tables (Query Results)
*   **Header:** `surface_container_high` with `label-md` uppercase text.
*   **Rows:** Alternate between `surface` and `surface_container_low`. Never use horizontal rules.

---

## 6. Do's and Don'ts

### Do
*   **Do** use asymmetrical padding (e.g., more padding on the left than the right) for headline sections to create an editorial, "high-end" feel.
*   **Do** use `tertiary` (#44d8f1) for data visualization accents—it cuts through the blue/indigo base with surgical precision.
*   **Do** leverage the `0.1rem` (0.5) spacing unit for micro-adjustments in the IDE layout to keep it feeling "dense but clean."

### Don't
*   **Don't** use pure white (#FFFFFF) for text. Always use `on_surface` (#e5e2e1) to maintain the premium dark-mode aesthetic and reduce glare.
*   **Don't** use standard 1px borders to separate the sidebar from the main content. Use a background shift from `surface_container_low` to `surface`.
*   **Don't** use rounded corners larger than `xl` (0.75rem). This is a technical tool; overly "bubbly" corners diminish the professional tone.
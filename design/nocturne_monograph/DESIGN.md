---
name: Nocturne Monograph
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f22'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#313032'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#b4c5ff'
  on-secondary: '#002a78'
  secondary-container: '#0053db'
  on-secondary-container: '#cdd7ff'
  tertiary: '#ffb786'
  on-tertiary: '#502400'
  tertiary-container: '#df7412'
  on-tertiary-container: '#461f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb786'
  on-tertiary-fixed: '#311400'
  on-tertiary-fixed-variant: '#723600'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
typography:
  display-hero:
    fontFamily: Geist
    fontSize: 56px
    fontWeight: '300'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-hero-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '300'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '400'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 26px
    fontWeight: '400'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0em
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0.005em
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Geist
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.25rem
  gutter-loose: 1.5rem
  margin: 0rem
  margin-page: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 3rem
---

## Brand & Style
The design system embodies a quiet, nocturnal museum gallery and high-end editorial photo monograph. Designed for private art collections, personal archives, and model visual portfolios, the interface dissolves entirely into the shadows, elevating photography to the absolute focus. The user experience evokes intimacy, discretion, and quiet reverence—stripping away visual noise, decorative embellishments, and aggressive UI affordances.

The design movement combines **Minimalism** with **Exhibition-Grade Functionalism**:
- **Monograph Restraint**: Pure void blacks (`#000000`), deep zinc canvas levels (`#09090b`), and whisper-quiet off-white text eliminate screen fatigue and mimic viewing prints in an ambient-lit darkroom.
- **Architectural Framing**: Razor-sharp, unrounded image boundaries contrast cleanly against delicately curved UI micro-controls.
- **Atmospheric Silence**: Zero drop shadows, non-intrusive translucent overlays, and hairline borders allow visual media to claim primary presence.

## Colors
The palette is calibrated strictly for light-absorbing, low-reflectance environments to give images unmatched depth and dynamic range.

- **Canvas & Surface Levels**:
  - `viewer-bg`: `#000000` (Dedicated zero-light canvas for full-screen photo rendering and unadulterated color fidelity).
  - `surface-base`: `#09090b` (Default page background; deep charcoal-black).
  - `surface-elevated`: `#121215` (Drawers, sheets, and elevated overlays).
  - `surface-hover`: `#18181b` (Subtle state response for interactive surfaces).
- **Text & Editorial Hierarchy**:
  - `text-primary`: `#f4f4f5` (Soft ivory off-white, preventing harsh contrast glare against dark fields).
  - `text-muted`: `#a1a1aa` (Mid-tone silver zinc for secondary details, metadata, and camera parameters).
  - `text-faint`: `#52525b` (Tertiary captions, timestamps, and placeholder states).
- **Accents & Operational States**:
  - `accent-primary`: `#3b82f6` (Used sparingly: accessibility focus rings, active batch selections, and primary edit actions).
  - `accent-active`: `#2563eb` (Pressed states and checked indicators).
- **Borders & Scrims**:
  - `border-hairline`: `rgba(255, 255, 255, 0.08)` (Ultra-subtle structure separation).
  - `scrim-bottom`: `linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.82) 100%)` (Ensures metadata legibility over photographs).

## Typography
Typography is architectural, crisp, and neutral. It relies on refined proportions and spacious tracking to produce an editorial tone. When rendering Korean alongside Latin characters, Pretendard Variable takes natural precedence with identical optical metrics and optical weights.

- **Display & Headings**: Set with lightweight profiles (`300` to `400`) and negative tracking. Headings suggest exhibition wing names, artist credits, and curation titles.
- **Body Text**: Tuned for effortless readability in dark environments without producing halation. Line heights are spacious (`1.6` ratio) to support contemplative reading.
- **Labels & Meta**: Uppercase or small-caps letter-spacing (`0.04em` to `0.08em`) for EXIF data (shutter speed, ISO, aperture), dates, and cataloguing indices.

## Layout & Spacing
The layout operates on two distinct spatial models:

1. **Exhibition Photo Canvas (Edge-to-Edge Fluidity)**:
   - Photo walls, masonry galleries, and index contact sheets use `margin: 0px` full bleeds.
   - Images are separated by a razor-thin grid gap: `gutter: 0.125rem` (2px) to `0.25rem` (4px). This reproduces traditional film strips, slide mount sheets, and contiguous contact prints.
2. **Editorial Content & Interface Frame**:
   - Layout transitions to comfortable margins for curation essays, artist statements, and account controls.
   - **Desktop (1440px+)**: 12-column grid, `margin-page: 3rem` (48px), max-width constraints for editorial reading (720px).
   - **Tablet (768px - 1024px)**: 8-column grid, `margin-page: 2rem` (32px), 3-column contact sheet layout.
   - **Mobile (390px - 430px)**: 4-column grid, `margin: 0px` for media, `margin-page: 1rem` (16px) for headers and interactive controls. Photo grids default to 2 columns with 2px gaps or single-column full-width bleeds.

## Elevation & Depth
In alignment with the monochrome darkroom aesthetic, **drop shadows are completely omitted (`box-shadow: none`)**. Depth is achieved solely through surface luminance stratification and semi-transparent scrims.

- **Zero Plane (`#000000`)**: Full-screen lightbox and presentation modes. UI overlays on top of the image auto-hide or fade to `opacity: 0`.
- **Base Canvas (`#09090b`)**: The primary browsing layer where photo collections are explored.
- **Floating Controls & Modals (`#121215`)**: Outlined by a crisp `1px solid rgba(255, 255, 255, 0.08)` border. Backdrop filters (`backdrop-filter: blur(16px)`) are applied to floating navigation bars and contextual inspector bars.
- **Protection Scrims**: When titles, badges, or controls rest over photos, a directional gradient (`linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0) 100%)`) preserves legibility without flattening the overall image.

## Shapes
A dual-form shape vocabulary establishes strict visual semantics:

- **Photographic Elements (`rounded-none`, `0px`)**:
  All visual assets—including portfolio images, album cover cards, thumbnails, and preview strips—must retain an absolute `0px` border-radius. This maintains an uncompromising, museum-quality print discipline.
- **UI Elements & Interactive Micro-Controls (`8px` to `10px`)**:
  Interactive buttons, chips, form inputs, modal dialogs, and bottom sheets use a gentle curvature (`roundedness: 2`, `8px` default, `10px` for large containers). This makes the interface soft to the touch without compromising the structural rigour of the framed media.

## Components

### Buttons & Interactive Controls
- **Ghost Buttons (Primary Style)**: Transparent backgrounds with soft off-white text (`#f4f4f5`) and Lucide line icons (stroke width `1.5`). On hover, the surface shifts to `rgba(255, 255, 255, 0.06)` with no border.
- **Editorial Action Buttons**: Minimal borders (`1px solid rgba(255, 255, 255, 0.15)`), `8px` corner radius, with subtle hover states.
- **Primary / Edit State Buttons**: Solid `#3b82f6` background with pure white text, strictly reserved for active workflow states (e.g., "Publish Album", "Save Selection", "Upload").

### Chips & Filter Tags
- Rendered in pill or rounded (`8px`) formats with `1px solid rgba(255, 255, 255, 0.08)`.
- Inactive state: `#121215` background with `#a1a1aa` text.
- Active state: `#f4f4f5` text with subtle electric blue accent indicator dot (`#3b82f6`, 6px circle) or hairlined blue border.

### Image Cards & Masonry Grids
- **Card Body**: Strict `0px` radius, zero box shadow, zero border.
- **Overlays**: Top and bottom edge scrims fade in seamlessly on touch or hover, revealing EXIF data, model credit, and secret album classification tags.
- **Hover/Touch State**: Image scales subtly (`scale(1.015)`) with an effortless `400ms cubic-bezier(0.16, 1, 0.3, 1)` easing, remaining tightly cropped within its bounds.

### Selection & Checkboxes
- **Selection State**: A discrete `#3b82f6` border (2px inset) highlights chosen images in multi-select management mode.
- **Checkboxes**: Pure minimalist `18px` squares with rounded `4px` corners, outlined in `rgba(255, 255, 255, 0.3)`. Checked state transitions instantly to solid `#3b82f6` with a white check icon.

### Form Inputs & Search Fields
- Minimalist line or sunken container (`#121215`) with `1px solid rgba(255, 255, 255, 0.08)` border.
- Focus state activates an electric blue focus line (`#3b82f6`, 1px outline or ring) with zero shadow spread. Placeholder text uses muted slate (`#52525b`).

### Full-Screen Photo Viewer (Lightbox)
- Absolute pure black backdrop (`#000000`).
- Floating top and bottom inspector ribbons in semi-transparent dark zinc (`rgba(9, 9, 11, 0.75)`, `backdrop-filter: blur(12px)`).
- Dismiss, zoom, and catalog navigation buttons feature high contrast (`#f4f4f5`), quiet ghost execution, and frictionless transitions.
# wizzn

A complete, production-ready design specification for **Variant 1 ("The Dopamine Rebound")** follows, detailing screen architecture, native iOS (HIG) and Android (Material Design 3) implementation specs, typography, component hierarchies, and interactive micro-states.

---

## 1. Global Navigation & Layout Architecture

Variant 1 replaces doom-scrolling with a vertical-paging viewport (1 viewport = 1 complete learning bite).

```
+-------------------------------------------------------------+
| [🔥 4/5 Units]   [• ALL • | Nutrition | Finance | ...] [⚙️]  | <- Floating Top App Bar (Z-index: 10)
+-------------------------------------------------------------+
|                                                             |
|  [Tag: Healthy Nutrition • Protein]                         |
|  Why 30g Morning Protein Stops Midday Crashes               |
|                                                             |
|  +-------------------------------------------------------+  |
|  |                                                       |  |
|  |             Central Graphic / Illustration            |  | <- 1-3 Adaptive AI Visuals
|  |                                                       |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  (Audio Wave Scrubber OR Horizontal Card Slider)             |
|                                                             |
|  [ ↗ Source: Harvard T.H. Chan Public Health ]              |
|                                                             |
+-------------------------------------------------------------+
|  [Stream]              [Explore Topics]            [Streak] | <- Native Bottom Navigation
+-------------------------------------------------------------+

```

### Bottom Navigation Bar (Root Tabs)

* **Tab 1: Stream (Active)** — Vertical paging feed of personalized AI-generated micro-units.


* **Tab 2: Topics** — Grid catalog containing the 5 core domains: *Healthy Nutrition, Partnership, Finance, Sports, Psychology*.


* **Tab 3: Progress & Streaks** — Weekly tracker (target: 5 units/week), badge cabinet, and habit-reset analytics.



---

## 2. Paged Feed Viewports: Audio vs. Written Units

### A. The Audio Bite Viewport (3–5 Minutes)

Designed for hands-free listening while retaining visual dopamine hooks.

```
+-------------------------------------------------------------+
| [🔥 3/5]              PSYCHOLOGY • PATTERNS             [ 🔖 ]|
+-------------------------------------------------------------+
|                                                             |
|  "The Spotlight Effect: Why Nobody Noticed Your Mistake"    |
|                                                             |
|  +-------------------------------------------------------+  |
|  |                                                       |  |
|  |     [ AI Illustration 1 of 2: Social Crowd Scene ]    |  | <- Carousel of 1-3 thematic drawings
|  |                                                       |  |
|  +-------------------------------------------------------+  |
|                         [ •  ○ ]                             | <- Image index dots
|                                                             |
|  01:45 ━━━━━━━━━━━━━━●──────────────────────── 03:20        | <- Audio waveform progress bar
|                                                             |
|             [⏪ 15s]     [ ▶ / ⏸ ]     [1.5x]               | <- Transport controls
|                                                             |
|  [ ↗ Source: American Psychological Association ]           | <- Verified citation linkout
|                                                             |
|  [ ✓ Finish Lesson (+1 Unit) ]                              | <- Active completion pill
+-------------------------------------------------------------+

```

* **Interactive Elements:**
* **Dynamic Artwork:** 1 to 3 curated illustrations/diagrams that auto-advance at key audio chapter marks.


* **Scrubber Bar:** Haptic-enabled slider displaying total lesson duration (3–5 minutes).


* **Speed Toggle:** Quick-chip cycling through `1.0x`, `1.25x`, and `1.5x`.
* **Completion CTA:** Lights up once 90% of the audio has played, awarding +1 toward the weekly streak.





---

### B. The Written Bite Viewport (3–5 Slider Pages)

A self-contained carousel breaking down a topic into snackable slides without external endless links.

```
+-------------------------------------------------------------+
| [🔥 3/5]              FINANCE • TAX OPTIMIZATION        [ 🔖 ]|
+-------------------------------------------------------------+
|                                                             |
|  +-------------------------------------------------------+  |
|  |  Slide 2 of 4: "The Home Office Lump Sum"             |  | <- Horizontal paging tracker
|  |                                                       |  |
|  |  You can deduct up to €1,260 annually without         |  |
|  |  submitting utility bills, provided you work          |  | <- Concise summary copy
|  |  primarily from a dedicated workspace.                |  |
|  |                                                       |  |
|  |       [ AI Infographic: Tax Deductions vs Income ]    |  |
|  |                                                       |  |
|  +-------------------------------------------------------+  |
|                                                             |
|                   [ •  ●  ○  ○ ]                             | <- Slide step indicator
|                                                             |
|  [ ↗ Original Source: Federal Tax Agency Guide ]            | <- Linkout directly to verified source
|                                                             |
|         < Swipe left for next tip (2/4) >                   |
+-------------------------------------------------------------+

```

* **Interactive Elements:**
* **Horizontal Paging Container:** Snaps smoothly through 3–5 slides. Vertical scrolling on the parent feed is locked while swiping horizontally.


* **Source Linkout:** Pill button opening an in-app browser (`SFSafariViewController` on iOS / `Custom Tabs` on Android) to review the source.


* **Final Slide Action:** Reaching slide 4 or 5 displays a prominent "Mark Unit Completed" button triggering the celebration reward.





---

## 3. Weekly Streak & Gamification HUD

Wizzn targets doom-scrolling replacement by instilling positive habit-loops centered on a **5 units per week** milestone.

```
+-------------------------------------------------------------+
|  WEEKLY SPRINT                           Streak: 3 Weeks 🔥 |
|  ---------------------------------------------------------  |
|      Mon     Tue     Wed     Thu     Fri     Sat     Sun    |
|     [ ✓ ]   [ ✓ ]   [ ✓ ]   [ ✓ ]   [ ○ ]   [   ]   [   ]   |
|                                                             |
|     Progress: 4 of 5 Completed (80%)                        |
|     [=======================================>      ]        |
|                                                             |
|     "1 more unit to secure this week's Dopamine Shield!"    |
+-------------------------------------------------------------+

```

* **Streak Calculation:** Increments whenever a user finishes at least 5 units within Monday 00:00 to Sunday 23:59.


* **Immediate Feedback:** Completing a unit triggers haptic feedback, a subtle particle burst, and an updated counter pill in the top header.



---

## 4. Platform-Specific Design Specifications

| Design Dimension | iOS (Apple Human Interface Guidelines) | Android (Google Material Design 3) |
| --- | --- | --- |
| **Typography** | Primary: **SF Pro Display** (Headings, 24–28pt Bold); Body: **SF Pro Text** (16pt Regular). | Primary: **Roboto** or **Google Sans**; Title Large (22sp), Body Medium (14sp). |
| **Top App Bar** | Ultra-thin translucent bar with `UIBlurEffect` (`.systemUltraThinMaterialDark`/`Light`). | `TopAppBar` with container color set to `surfaceColorAtElevation(1.dp)`. |
| **Bottom Navigation** | Standard `UITabBar` with blur backing, 49pt height + safe area, labeled SF Symbols (`play.square.stack`, `square.grid.2x2`, `flame.fill`). | M3 `NavigationBar` (80dp height) with pill active indicator (`tonalPalette`) and Material Symbols. |
| **Paging Motion** | `UICollectionView` / SwiftUI `ScrollView` with `.paging` behavior and interactive spring transitions. | Jetpack Compose `VerticalPager` with `snapFlingBehavior` and predictive back support. |
| **Color System** | iOS System Vibrant tints: Electric Mint (`#00E599`), Deep Slate background (`#0D0F12`), high-contrast text. | Dynamic Material You theming derived from category tones (e.g., Mint for Sports, Warm Amber for Finance). |
| **Haptic Triggers** | `UIImpactFeedbackGenerator(style: .medium)` on unit snap; `UINotificationFeedbackGenerator(.success)` on unit finish. | `HapticFeedbackConstants.CONFIRM` on completing 5-unit weekly goal; `TEXT_HANDLE_MOVE` on scrub. |
| **Touch Boundaries** | Minimum 44 × 44 pt hit targets on audio scrubbers and source links. | Minimum 48 × 48 dp interactive touch boundaries for all actionable chips. |

---

## 5. First-Time Setup: Topic Selection Sheet

When users aged 16+ launch the app, they set their initial dopamine-swap targets:

1. **Category Pills (Multi-select, 3+ recommended):**
* 🥗 **Healthy Nutrition** (Protein, Vegan, Vegetarian, Keto)


* 🤝 **Partnership** (Seduction, Needs, Love, Partnership Balance)


* 💰 **Finance** (Investments, Tax Optimization, Budget Control)


* 🏃 **Sports** (Routine, Workouts, Strength, Cardio)


* 🧠 **Psychology** (Behavior Patterns, Neurodivergence, Developmental, Social)




2. **Format Preference:**
* `🎧 Mostly Audio (3–5 min listens)`

* `📄 Mostly Decks (3–5 slide reads)`

* `⚡ Balanced Mix`



# Color schema

Visual styling specifications, palette definitions, and mock card designs for **wizzn** follow, directly translating the hyper-engaging visual energy of Instagram and TikTok into high-retention micro-learning units.

---

## 1. Color Schemas: Social-Inspired Dopamine Palettes

To capture the visual rush of doom-scrolling apps while keeping educational content legible, the color system pairs deep dark-mode backgrounds with high-saturation neon gradients tailored to the 5 core categories.

| Category | Schema Name | Accent Gradient (Hex) | Background Tone | TikTok / IG Vibe |
| --- | --- | --- | --- | --- |
| **Psychology**<br> | *Hyper-Violet & Electric Cyan* | `#8A2387` → `#E94057` → `#F27121` | `#0B0C10` (Midnight Black) | TikTok viral soundstage & neon street aesthetic |
| **Finance**<br> | *Acid Lime & Deep Jade* | `#00FF87` → `#60EFFF` | `#0E1318` (Gunmetal Navy) | High-contrast trading & fintech dashboard look |
| **Partnership**<br> | *Sunset Coral & Magenta Glow* | `#FF0844` → `#FFB199` | `#140D14` (Deep Plum) | Instagram Stories golden-hour / gradient-ring vibe |
| **Healthy Nutrition**<br> | *Matcha Glow & Sunny Amber* | `#A8FF78` → `#78FFD6` | `#0D1510` (Dark Forest) | Fresh, high-vitality wellness feed |
| **Sports**<br> | *Electric Cobalt & Blaze Orange* | `#FF416C` → `#FF4B2B` | `#0D0F14` (Onyx Slate) | High-adrenaline athletic reels |

---

## 2. Visual Component Layouts

### A. The Audio Card: "Neon Synthwave" (Psychology / Social Dynamics)



*Theme: Electric Neon & Glassmorphism over Dark Obsidian*

```
+-------------------------------------------------------------+
| [🔥 3/5]         PSYCHOLOGY • SOCIAL DYNAMICS           [🔖] |
+-------------------------------------------------------------+
|                                                             |
|  "The Spotlight Effect: No One Saw Your Flub"               |
|                                                             |
|  +-------------------------------------------------------+  |
|  |  . . . . . . . . . . . . . . . . . . . . . . . . . .  |  |
|  |               ( ( ( 👁️ ) ) )                           |  | <- AI Graphic: Minimalist neon illustration
|  |     [ Glowing Magenta Spotlight on Shadowed Figure ]  |  |    (1 of 2 visual chapters)[cite: 1]
|  |  . . . . . . . . . . . . . . . . . . . . . . . . . .  |  |
|  +-------------------------------------------------------+  |
|                            [ • ○ ]                          |
|                                                             |
|    02:14  | |l|l|||l|l|||||||ll||l|l· · · · · ·   03:45      | <- Glowing Cyan-to-Purple waveform scrubber[cite: 1]
|                                                             |
|             [ ⏪ 15s ]     [  ▶  ]     [ 1.5x ]             | <- Frosted glass pill buttons
|                                                             |
|  [ ↗ Source: American Psychological Association ]           | <- Direct citation pill[cite: 1]
|                                                             |
|  [ ⚡ Tap when Done (+1 Toward Weekly Goal) ]                | <- Glowing gradient button (Mon-Sun streak)[cite: 1]
+-------------------------------------------------------------+
|  [ 🎧 Stream ]         [ 🔍 Explore ]       [ 🏆 Streak ]   |
+-------------------------------------------------------------+

```

* **Visual Assets:**
* **Illustration Container:** Soft-edged rectangular canvas with a 1px border gradient (`linear-gradient(135deg, #E94057, #8A2387)`). Minimal vector lines with glowing outer drop-shadows (Glow radius: `16px`).
* **Waveform:** Dynamic audio bars that fluctuate between vivid cyan (`#60EFFF`) and warm pink (`#E94057`) based on frequency.



---

### B. The Written Card Deck: "Fintech Acid-Green" (Finance / Tax)



*Theme: TikTok/Reels Text-Overlay Aesthetic with High Contrast*

```
+-------------------------------------------------------------+
| [🔥 4/5]             FINANCE • TAX OPTIMIZATION         [🔖] |
+-------------------------------------------------------------+
|                                                             |
|  +-------------------------------------------------------+  |
|  |  SLIDE 2 OF 4                              [ 50% ]    |  | <- Gradient progress tracker bar[cite: 1]
|  |                                                       |  |
|  |  "The €1,260 Home-Office Loophole"                    |  | <- Big bold title (TikTok caption style)
|  |                                                       |  |
|  |  • You don't need a separate dedicated study room.    |  |
|  |  • Claim €6/day for up to 210 days working remote.    |  | <- Digestible micro-copy
|  |                                                       |  |
|  |       +---------------------------------------+       |  |
|  |       |   [ AI 3D Render: Floating Isometric  |       |  | <- Stylized 3D graphic / icon
|  |       |     Laptop with Glowing Coins ]       |       |  |
|  |       +---------------------------------------+       |  |
|  +-------------------------------------------------------+  |
|                                                             |
|                      [ ○  ●  ○  ○ ]                          | <- Slide indicator dots[cite: 1]
|                                                             |
|  [ ↗ Source: Bundesfinanzministerium.de ]                   | <- Verified source linkout[cite: 1]
|                                                             |
|               < Swipe left for next tip >                   |
+-------------------------------------------------------------+
|  [ 🎧 Stream ]         [ 🔍 Explore ]       [ 🏆 Streak ]   |
+-------------------------------------------------------------+

```

* **Visual Assets:**
* **Card Container:** Charcoal container (`#12161A`) with a subtle glowing edge (`#00FF87` at 20% opacity).
* **Data Visual:** 3D claymorphic or clean vector graphics with vibrant lime highlights (`#00FF87`) against matte black to emphasize fast information parsing.



---

### C. The Gamified Streak Badge: "The Dopamine Shield" (Weekly Goal)



*Theme: Duolingo meets Instagram Close Friends badge*

```
+-------------------------------------------------------------+
|                     WEEKLY STREAK UNLOCKED                  |
|                                                             |
|                        . : * 🔥 * : .                       |
|                     /=================\                     |
|                    |     5 OF 5        |                    | <- 5 completed units target[cite: 1]
|                    |  UNITS MASTERED   |                    |
|                     \=================/                     |
|                        ' : * 🛡️ * : .                       |
|                                                             |
|   Mon     Tue     Wed     Thu     Fri     Sat     Sun       |
|  [ ✓ ]   [ ✓ ]   [ ✓ ]   [ ✓ ]   [ ✓ ]   [ - ]   [ - ]      |
|                                                             |
|    "You swapped 45 minutes of brainrot for real knowledge." |
|                                                             |
|               [ Claim Reward & Share Story ]                |
+-------------------------------------------------------------+

```

* **Visual Assets:**
* **Badge Graphic:** Multi-layered metallic shield featuring an animated burning flame with particle sparks.
* **Share Action:** Direct export formatted for Instagram Stories / TikTok (`9:16` aspect ratio) with high-saturation gradient frames to encourage viral loops.



---

## 3. Micro-Interaction Design Specifications

* **Card-Snap Bounce:** As the user scrolls vertically from one unit to the next, the incoming card overshoots by 4px before snapping with spring dampening (`tension: 300, friction: 20`), mirroring TikTok's responsive feed physics.
* **Audio Wave Pulse:** During audio playback, the progress scrubber pulses with a dynamic glow that scales subtly to low-frequency beats.
* **Double-Tap "Save to Brain":** Double-tapping anywhere on the lesson card fires a floating neon brain icon that scales up and fades out (analogous to the Instagram heart gesture), saving the bite to the user's personal vault.

Would you like to detail the **Onboarding Interest-Picker** screen or the **Administrator Content Generation CMS** next?



# Samples

check ```samples/*.png``` for sample how the app layout inspiration


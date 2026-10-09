# CLAUDE.md — Developer & Agent Guidelines

## Platform Design Guidelines & Icon Mapping (Issue #36)

The wizzn application is deployed cross-platform to Web, iOS (Capacitor), and Android (Capacitor).

### Dual Icon Set Architecture
- **Android & Web:** Google Material Icons (`material-icons`).
- **iOS:** Ionicons v4 (`ionicons-v4`, prefix `ion-ios-*` / `ion-*`), modeled after Apple SF Symbols.

### Maintaining Icon Mappings
When introducing or changing icons in Vue components:
1. Always check `packages/web/src/utils/platformIcons.ts`.
2. Ensure the icon key has an entry in `ICON_MAP`:
   ```typescript
   export const ICON_MAP: Record<string, IconDefinition> = {
     // example:
     my_new_icon: { android: 'material_name', ios: 'ion-ios-equivalent' },
   }
   ```
3. Use the `usePlatform` composable:
   ```vue
   <script setup lang="ts">
   import { usePlatform } from 'src/composables/usePlatform'

   const { pIcon } = usePlatform()
   </script>

   <template>
     <q-btn :icon="pIcon('my_new_icon')" />
     <!-- or <q-icon :name="pIcon('my_new_icon')" /> -->
   </template>
   ```
4. If an icon is not in `ICON_MAP`, it defaults to the literal name passed.

### Semantic Icon Guidelines
- **Pin / Lock:** Use `push_pin` (iOS: `ion-ios-pin`) instead of generic lock.
- **Add to Setlist:** Use `library_add` (iOS: `ion-ios-add-circle-outline`) and `library_add_check` (iOS: `ion-ios-checkmark-circle-outline`).
- **Voting:** Use `thumb_up` and `thumb_down` (iOS: `ion-ios-thumbs-up` / `ion-ios-thumbs-down`).
- **Accept into Master:** Use `done` (iOS: `ion-ios-checkmark`).
- **Archive / Unarchive:** Use `inventory_2` (iOS: `ion-ios-archive`) and `replay` (iOS: `ion-ios-refresh`).
- **Drag Reorder:** Use `drag_handle` (iOS: `ion-ios-menu`).

### Dialogs & Actions
- **Dialogs on iOS:** Form modals should use bottom sheets (`:position="isIos ? 'bottom' : 'standard'"`). Confirmation dialogs use Action Sheet styling.
- **Primary Action Buttons:** Primary add/create buttons on Android use a bottom-right FAB (`<q-page-sticky>`); on iOS they are positioned in the top-right toolbar/header.
- **Binary Toggles:** Use segmented controls (`<SegmentedControl>`) instead of `<q-tabs>`.

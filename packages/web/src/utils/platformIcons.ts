export interface IconDefinition {
  android: string
  ios: string
}

/** Icon keys used in the app → Material (Android/Web) and Ionicons v4 (iOS). See CLAUDE.md. */
export const ICON_MAP: Record<string, IconDefinition> = {
  play: { android: 'play_arrow', ios: 'ion-ios-play' },
  pause: { android: 'pause', ios: 'ion-ios-pause' },
  check: { android: 'done', ios: 'ion-ios-checkmark' },
  check_circle: { android: 'check_circle', ios: 'ion-ios-checkmark-circle' },
  link: { android: 'open_in_new', ios: 'ion-ios-open' },
  source: { android: 'north_east', ios: 'ion-ios-open' },
  image_credit: { android: 'info', ios: 'ion-ios-information-circle-outline' },
  settings: { android: 'tune', ios: 'ion-ios-options' },
  gear: { android: 'settings', ios: 'ion-ios-settings' },
  headphones: { android: 'headphones', ios: 'ion-ios-headset' },
  slides: { android: 'view_carousel', ios: 'ion-ios-albums' },
  description: { android: 'description', ios: 'ion-ios-document' },
  bolt: { android: 'bolt', ios: 'ion-ios-flash' },
  back: { android: 'arrow_back', ios: 'ion-ios-arrow-back' },
  forward: { android: 'arrow_forward', ios: 'ion-ios-arrow-forward' },
  chevron_right: { android: 'chevron_right', ios: 'ion-ios-arrow-forward' },
  explore: { android: 'explore', ios: 'ion-ios-compass' },
  info: { android: 'info_outline', ios: 'ion-ios-information-circle-outline' },
  refresh: { android: 'refresh', ios: 'ion-ios-refresh' },
  profile: { android: 'person', ios: 'ion-ios-person' },
  lock: { android: 'lock', ios: 'ion-ios-lock' },
  // Bottom navigation (LAYOUT.md §4): play.square.stack / square.grid.2x2 / flame.fill
  tab_stream: { android: 'subscriptions', ios: 'ion-ios-play-circle' },
  tab_explore: { android: 'grid_view', ios: 'ion-ios-apps' },
  tab_streak: { android: 'local_fire_department', ios: 'ion-ios-flame' },
  // Audio transport
  rewind: { android: 'fast_rewind', ios: 'ion-ios-rewind' },
  // Save to brain / vault
  bookmark: { android: 'bookmark_border', ios: 'ion-ios-bookmark' },
  bookmark_filled: { android: 'bookmark', ios: 'ion-ios-bookmark' },
  share: { android: 'ios_share', ios: 'ion-ios-share' },
  add: { android: 'add', ios: 'ion-ios-add' },
  close: { android: 'close', ios: 'ion-ios-close' },
}

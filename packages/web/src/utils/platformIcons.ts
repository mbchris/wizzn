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
  settings: { android: 'tune', ios: 'ion-ios-options' },
  headphones: { android: 'headphones', ios: 'ion-ios-headset' },
  slides: { android: 'view_carousel', ios: 'ion-ios-albums' },
  back: { android: 'arrow_back', ios: 'ion-ios-arrow-back' },
  forward: { android: 'arrow_forward', ios: 'ion-ios-arrow-forward' },
  explore: { android: 'explore', ios: 'ion-ios-compass' },
  info: { android: 'info_outline', ios: 'ion-ios-information-circle-outline' },
  refresh: { android: 'refresh', ios: 'ion-ios-refresh' },
}

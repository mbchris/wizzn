declare namespace NodeJS {
  interface ProcessEnv {
    API_URL: string
    REVENUECAT_IOS_KEY: string
    REVENUECAT_ANDROID_KEY: string
    GOOGLE_WEB_CLIENT_ID: string
    GOOGLE_IOS_CLIENT_ID: string
  }
}

/** Injected by the Capacitor native runtime; absent in the browser */
interface Window {
  Capacitor?: {
    isNativePlatform(): boolean
    getPlatform(): 'ios' | 'android' | 'web'
    Plugins: Record<string, unknown>
  }
}

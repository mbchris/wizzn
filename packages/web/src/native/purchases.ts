import { nativePlugin, platform } from './capacitor'

// Subset of @revenuecat/purchases-capacitor (installed in src-capacitor) used by the app
export interface StoreProduct {
  identifier: string
  title: string
  priceString: string
  subscriptionPeriod?: string | null
}
export interface StorePackage {
  identifier: string
  packageType: string
  product: StoreProduct
}
interface PurchasesPlugin {
  configure(o: { apiKey: string; appUserID: string }): Promise<void>
  logIn(o: { appUserID: string }): Promise<unknown>
  getOfferings(): Promise<{ current: { availablePackages: StorePackage[] } | null }>
  purchasePackage(o: { aPackage: StorePackage }): Promise<unknown>
  restorePurchases(): Promise<unknown>
}

/** RevenueCat PURCHASE_CANCELLED */
const CANCELLED_CODE = '1'

let configuredFor: string | null = null

function plugin(): PurchasesPlugin | null {
  return nativePlugin<PurchasesPlugin>('Purchases')
}

function apiKey(): string {
  return platform() === 'ios' ? process.env.REVENUECAT_IOS_KEY : process.env.REVENUECAT_ANDROID_KEY
}

export function purchasesAvailable(): boolean {
  return plugin() !== null && apiKey() !== ''
}

/** RevenueCat's app user id is our user id, so webhooks map straight to `entitlement.user_id` */
async function ready(userId: string): Promise<PurchasesPlugin> {
  const p = plugin()
  if (!p || !apiKey()) throw new Error('In-App-Käufe sind nur in der App verfügbar.')
  if (configuredFor === null) await p.configure({ apiKey: apiKey(), appUserID: userId })
  else if (configuredFor !== userId) await p.logIn({ appUserID: userId })
  configuredFor = userId
  return p
}

export async function loadPackages(userId: string): Promise<StorePackage[]> {
  const offerings = await (await ready(userId)).getOfferings()
  return offerings.current?.availablePackages ?? []
}

/** Resolves false when the user cancelled the store sheet */
export async function buy(userId: string, pkg: StorePackage): Promise<boolean> {
  try {
    await (await ready(userId)).purchasePackage({ aPackage: pkg })
    return true
  } catch (e) {
    const err = e as { code?: string | number; userCancelled?: boolean }
    if (err.userCancelled || String(err.code) === CANCELLED_CODE) return false
    throw e
  }
}

export async function restore(userId: string): Promise<void> {
  await (await ready(userId)).restorePurchases()
}

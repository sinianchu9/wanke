import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PaymentResult from "@/components/payment-result";
import { getPageUser } from "@/lib/auth";

export const metadata: Metadata = { title: "支付结果 · Wanke" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

/**
 * Return page after the Alipay cashier.
 *
 * Alipay appends its own parameters (`out_trade_no`, `trade_no`, `sign`, …) to the
 * return address. They are only used to find the order to display: nothing on this page
 * can grant a benefit, the server settles the order from the verified notification or
 * from an active query.
 */
export default async function PaymentResultPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const orderNo = (first(params.orderNo) || first(params.out_trade_no)).trim();
  const user = await getPageUser();
  return <PaymentResult orderNo={orderNo} isLoggedIn={Boolean(user)} />;
}

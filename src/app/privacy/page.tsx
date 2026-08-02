import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/LegalShell";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: "Privacy Policy — Ttip",
  description: `Privacy Policy for Ttip, a product of ${COMPANY.legalName}.`,
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This Privacy Policy explains how {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), the operator
        of {COMPANY.product}, collects, uses, and protects your personal information when you use the{" "}
        {COMPANY.product} application and website at {COMPANY.domain}.
      </p>

      <LegalSection heading="1. Information we collect">
        <p>We collect information you provide and information generated as you use {COMPANY.product}:</p>
        <ul className="list-disc pl-5 flex flex-col gap-1.5">
          <li>Account details: name, email, username, and password.</li>
          <li>Identity data for KYC: BVN or NIN, and the name and details on that record, used to verify you.</li>
          <li>Financial data: crypto and bank transactions, balances, payout bank details, and beneficiaries.</li>
          <li>Technical data: device and app information needed to keep your account secure.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. How we use your information">
        <p>
          We use your information to operate {COMPANY.product} — to create and secure your account, verify your
          identity, process deposits, swaps, tips, purchases, and withdrawals, prevent fraud and money
          laundering, provide support, and meet our legal and regulatory obligations.
        </p>
      </LegalSection>

      <LegalSection heading="3. Sharing your information">
        <p>
          We share information only as needed to provide the service: with identity-verification providers to
          confirm your KYC, with payment and settlement partners to move funds to your bank, and with
          authorities where required by law. We do not sell your personal information.
        </p>
      </LegalSection>

      <LegalSection heading="4. Data security">
        <p>
          We protect your data with encryption in transit, hashed passwords and PINs, and access controls. No
          system is perfectly secure, so you also play a part by keeping your credentials and PIN confidential.
        </p>
      </LegalSection>

      <LegalSection heading="5. Data retention">
        <p>
          We retain your information for as long as your account is active and for any additional period
          required to meet legal, regulatory, tax, accounting, and anti-money-laundering obligations.
        </p>
      </LegalSection>

      <LegalSection heading="6. Your rights">
        <p>
          Subject to applicable law, you may request access to, correction of, or deletion of your personal
          information. Some data must be retained to meet regulatory requirements even after account closure.
          To make a request, contact us using the details below.
        </p>
      </LegalSection>

      <LegalSection heading="7. Contact">
        <p>
          For privacy questions or requests, contact {COMPANY.legalName} at{" "}
          <a href={`mailto:${COMPANY.supportEmail}`} className="text-good">{COMPANY.supportEmail}</a>
          {COMPANY.registeredAddress ? `, or by writing to ${COMPANY.registeredAddress}` : ""}.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

import type { Metadata } from "next";
import { LegalShell, LegalSection } from "@/components/LegalShell";
import { COMPANY } from "@/lib/company";

export const metadata: Metadata = {
  title: "Terms of Service — Ttip",
  description: `Terms of Service for Ttip, a product of ${COMPANY.legalName}.`,
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of {COMPANY.product}, a digital
        asset and payments product owned and operated by {COMPANY.legalName}, a company registered in{" "}
        {COMPANY.country}
        {COMPANY.rcNumber ? ` (${COMPANY.rcNumber})` : ""}
        {COMPANY.registeredAddress ? `, with its registered office at ${COMPANY.registeredAddress}` : ""}. By
        creating an account or using {COMPANY.product}, you agree to these Terms.
      </p>

      <LegalSection heading="1. Who we are">
        <p>
          {COMPANY.product} is operated by {COMPANY.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;,
          &ldquo;our&rdquo;). References to {COMPANY.product} throughout these Terms mean the {COMPANY.product}{" "}
          application and website at {COMPANY.domain}, operated by {COMPANY.legalName}.
        </p>
      </LegalSection>

      <LegalSection heading="2. Eligibility & accounts">
        <p>
          You must be at least 18 years old and able to form a binding contract to use {COMPANY.product}. You
          agree to provide accurate information and to keep your login credentials and transaction PIN secure.
          You are responsible for activity that occurs under your account.
        </p>
      </LegalSection>

      <LegalSection heading="3. Identity verification (KYC)">
        <p>
          To comply with applicable anti-money-laundering and know-your-customer regulations, we verify your
          identity (for example, via BVN or NIN) before you can withdraw funds or move value off the platform.
          We may decline, suspend, or limit accounts where verification cannot be completed or where we are
          required to do so by law.
        </p>
      </LegalSection>

      <LegalSection heading="4. Services">
        <p>
          {COMPANY.product} lets you receive supported crypto assets, convert them to supported local
          currencies at the rate quoted at the time of the transaction, send tips to other users, buy supported
          crypto assets, and withdraw funds to a bank account. Exchange rates include a spread which is
          disclosed as part of the quote.
        </p>
      </LegalSection>

      <LegalSection heading="5. Transactions & fees">
        <p>
          Crypto and blockchain transactions are irreversible. You are responsible for confirming recipient
          addresses, bank account details, networks, and amounts before you confirm a transaction. Applicable
          network fees, service fees, and exchange spreads are shown before you confirm. Once submitted,
          transactions generally cannot be recalled.
        </p>
      </LegalSection>

      <LegalSection heading="6. Prohibited use">
        <p>
          You may not use {COMPANY.product} for any unlawful purpose, including fraud, money laundering,
          financing of illegal activity, or any activity that violates applicable law or the rules of our
          payment and settlement partners. We may report suspicious activity to the relevant authorities.
        </p>
      </LegalSection>

      <LegalSection heading="7. Risk disclosure">
        <p>
          Digital assets are volatile and their value can rise or fall. {COMPANY.legalName} does not provide
          investment advice. You use {COMPANY.product} at your own risk and are responsible for any tax
          obligations arising from your use of the service.
        </p>
      </LegalSection>

      <LegalSection heading="8. Limitation of liability">
        <p>
          To the fullest extent permitted by law, {COMPANY.legalName} is not liable for indirect, incidental,
          or consequential losses, or for losses arising from your provision of incorrect transaction details,
          unauthorized access resulting from your failure to safeguard your credentials, or events outside our
          reasonable control.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be notified in-app or by email.
          Your continued use of {COMPANY.product} after changes take effect constitutes acceptance of the
          updated Terms.
        </p>
      </LegalSection>

      <LegalSection heading="10. Contact">
        <p>
          Questions about these Terms can be sent to{" "}
          <a href={`mailto:${COMPANY.supportEmail}`} className="text-good">{COMPANY.supportEmail}</a>, or by
          writing to {COMPANY.legalName}
          {COMPANY.registeredAddress ? `, ${COMPANY.registeredAddress}` : ` in ${COMPANY.country}`}.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

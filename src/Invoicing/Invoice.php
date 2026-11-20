<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use DateTimeImmutable;
use InvalidArgumentException;

/**
 * An outgoing invoice with everything that is printed and written to the XML.
 * Amounts are whole cents in EUR.
 *
 * VAT categories follow EN 16931 (UNTDID 5305): "S" standard rate, "E" exempt.
 * A small business (Kleinunternehmer, § 19 UStG) shows no VAT at all; its lines
 * use category "E" with the exemption reason SMALL_BUSINESS_NOTE.
 */
final readonly class Invoice
{
    public const TYPE_INVOICE = '380';
    public const TYPE_CREDIT_NOTE = '381';

    public const SMALL_BUSINESS_NOTE = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).';

    /**
     * @param list<InvoiceLine> $lines
     * @param ?string $exemptionReason printed reason for lines with 0 % when not a small business
     */
    public function __construct(
        public string $number,
        public DateTimeImmutable $issueDate,
        public DateTimeImmutable $deliveryDate,
        public DateTimeImmutable $dueDate,
        public Party $seller,
        public Party $buyer,
        public array $lines,
        public bool $smallBusiness,
        public string $iban,
        public ?string $bic = null,
        public string $type = self::TYPE_INVOICE,
        public ?string $exemptionReason = null,
        public ?string $note = null,
        public ?string $precedingNumber = null,
    ) {
        if (!preg_match('/^[A-Z0-9][A-Z0-9-]{0,29}$/D', $number)) {
            throw new InvalidArgumentException('The invoice number may hold capital letters, digits and hyphens only.');
        }
        if ($lines === []) {
            throw new InvalidArgumentException('An invoice needs at least one line.');
        }
        if (!in_array($type, [self::TYPE_INVOICE, self::TYPE_CREDIT_NOTE], true)) {
            throw new InvalidArgumentException('Unknown invoice type.');
        }
        if ($type === self::TYPE_CREDIT_NOTE && $precedingNumber === null) {
            throw new InvalidArgumentException('A cancellation must name the invoice it cancels.');
        }
        if ($dueDate < $issueDate) {
            throw new InvalidArgumentException('The due date must not be before the issue date.');
        }
        if ($seller->taxNumber === null && $seller->vatId === null) {
            throw new InvalidArgumentException('The seller needs a tax number or a VAT id (§ 14 Abs. 4 Nr. 2 UStG).');
        }
        if ($seller->vatId === null && $seller->id === null) {
            throw new InvalidArgumentException('Without a VAT id the seller needs an identifier (EN 16931 BR-CO-26).');
        }
        if (!self::isValidIban($iban)) {
            throw new InvalidArgumentException('The IBAN is not valid.');
        }
        foreach ($lines as $line) {
            if ($smallBusiness && $line->vatRate !== 0) {
                throw new InvalidArgumentException('A small business must not charge VAT (§ 19 UStG, § 14c UStG).');
            }
            if (!$smallBusiness && $line->vatRate === 0 && ($exemptionReason === null || trim($exemptionReason) === '')) {
                throw new InvalidArgumentException('Lines without VAT need an exemption reason.');
            }
        }
    }

    /** EN 16931 VAT category code of a line. */
    public function categoryOf(InvoiceLine $line): string
    {
        return $line->vatRate === 0 ? 'E' : 'S';
    }

    /** Reason printed and written for exempt lines. */
    public function exemptionText(): string
    {
        return $this->smallBusiness ? self::SMALL_BUSINESS_NOTE : (string)$this->exemptionReason;
    }

    /**
     * VAT breakdown, one entry per category and rate, sorted by rate descending.
     *
     * @return list<array{category: string, rate: int, basis: int, tax: int}>
     */
    public function vatBreakdown(): array
    {
        $groups = [];
        foreach ($this->lines as $line) {
            $key = $this->categoryOf($line) . $line->vatRate;
            $groups[$key] ??= ['category' => $this->categoryOf($line), 'rate' => $line->vatRate, 'basis' => 0, 'tax' => 0];
            $groups[$key]['basis'] += $line->netCents();
        }
        foreach ($groups as &$group) {
            // EN 16931 BR-S-09: the tax of a group is computed on its basis, rounded to cents.
            $group['tax'] = intdiv($group['basis'] * $group['rate'] + 50, 100);
        }
        unset($group);
        usort($groups, static fn (array $a, array $b): int => $b['rate'] <=> $a['rate']);

        return $groups;
    }

    public function netTotal(): int
    {
        return array_sum(array_map(static fn (InvoiceLine $l): int => $l->netCents(), $this->lines));
    }

    public function taxTotal(): int
    {
        return array_sum(array_column($this->vatBreakdown(), 'tax'));
    }

    public function grossTotal(): int
    {
        return $this->netTotal() + $this->taxTotal();
    }

    /** ISO 13616 check (mod 97). */
    public static function isValidIban(string $iban): bool
    {
        $iban = strtoupper(str_replace(' ', '', $iban));
        if (!preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/D', $iban)) {
            return false;
        }
        $digits = '';
        foreach (str_split(substr($iban, 4) . substr($iban, 0, 4)) as $char) {
            $digits .= ctype_digit($char) ? $char : (string)(ord($char) - 55);
        }
        $rest = 0;
        foreach (str_split($digits, 7) as $chunk) {
            $rest = (int)($rest . $chunk) % 97;
        }

        return $rest === 1;
    }
}

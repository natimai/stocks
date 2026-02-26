import React from 'react';
import { motion } from 'framer-motion';

function DigitColumn({ digit }) {
    const isNumber = !isNaN(digit) && digit !== ' ';

    if (!isNumber) {
        return (
            <span className="inline-flex justify-center" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {digit}
            </span>
        );
    }

    const num = parseInt(digit, 10);
    // 0-9 array. Height of each digit is 1em.

    return (
        <span
            className="relative inline-block overflow-hidden"
            style={{
                height: '1em',
                width: '0.6em',
                lineHeight: '1em',
                verticalAlign: 'middle',
                fontVariantNumeric: 'tabular-nums'
            }}
        >
            <motion.div
                initial={false}
                animate={{ y: `-${num}em` }}
                transition={{ type: "spring", stiffness: 450, damping: 35, mass: 0.8 }}
                className="absolute inset-x-0 top-0 flex flex-col text-center"
            >
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span key={n} className="flex items-center justify-center" style={{ height: '1em', lineHeight: '1em' }}>
                        {n}
                    </span>
                ))}
            </motion.div>
        </span>
    );
}

export default function RollingPrice({ price, className, style }) {
    if (price == null) return null;

    // Format the number strictly to 2 decimal places with commas
    const formattedStr = `$${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const chars = formattedStr.split('');

    return (
        <div className={`flex items-center ${className || ''}`} style={{ lineHeight: '1em', ...style }}>
            {chars.map((char, index) => {
                // Determine place value from the right, so columns persist correctly as number grows
                // For instance, the penny column is always placeValue 1, dime is 2, etc.
                const placeValue = chars.length - index;
                const key = isNaN(char) ? `${char}-${placeValue}` : `num-${placeValue}`;

                return <DigitColumn key={key} digit={char} />;
            })}
        </div>
    );
}

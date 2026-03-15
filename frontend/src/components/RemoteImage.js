'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';

const LOGO_KIT_TOKEN = 'pk_frfa213068bb8ffac35321';


export function passthroughImageLoader({ src }) {
    return src;
}


export function RemoteImage({ src, alt, className, sizes, width, height, fill = false, onError, priority = false }) {
    if (!src) return null;

    const sharedProps = {
        src,
        alt,
        loader: passthroughImageLoader,
        unoptimized: true,
        className,
        sizes,
        onError,
        priority,
    };

    if (fill) {
        return <Image {...sharedProps} alt={alt} fill />;
    }

    return <Image {...sharedProps} alt={alt} width={width} height={height} />;
}


export function TickerLogoImage({ ticker, alt, size = 40, className, query = '' }) {
    const [hidden, setHidden] = useState(false);
    const src = useMemo(() => {
        if (!ticker) return '';
        const suffix = query ? `&${query}` : '';
        return `https://img.logokit.com/ticker/${ticker}?token=${LOGO_KIT_TOKEN}${suffix}`;
    }, [ticker, query]);

    if (!ticker || hidden) return null;

    return (
        <RemoteImage
            src={src}
            alt={alt}
            width={size}
            height={size}
            sizes={`${size}px`}
            className={className}
            onError={() => setHidden(true)}
        />
    );
}

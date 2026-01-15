import { useState } from 'react';

interface RobustImageProps {
    code: string;
    className?: string;
    style?: React.CSSProperties;
    priority?: 'jpg' | 'bmp';
    userRefMap?: Record<string, { image: string }>;
}

export const RobustImage = ({ code, className, style, priority = 'jpg', userRefMap }: RobustImageProps) => {
    const getSafeImageSrc = (code: string, p: 'jpg' | 'bmp') => {
        const baseSources = p === 'jpg'
            ? [
                `/images/perfiles/${code}.jpg`,
                `/images/perfiles/${code}.bmp`,
                `/images/ai-references/${code}.jpg`,
                `/images/${code}.jpg`,
                `/images/${code}.bmp`
            ]
            : [
                `/images/perfiles/${code}.bmp`,
                `/images/perfiles/${code}.jpg`,
                `/images/ai-references/${code}.jpg`,
                `/images/${code}.bmp`,
                `/images/${code}.jpg`
            ];

        if (userRefMap && userRefMap[code]) {
            return [userRefMap[code].image, ...baseSources];
        }
        return baseSources;
    };

    const [srcIdx, setSrcIdx] = useState(0);
    const sources = getSafeImageSrc(code, priority);

    return (
        <img
            src={sources[srcIdx]}
            onError={() => {
                if (srcIdx < sources.length - 1) {
                    setSrcIdx(srcIdx + 1);
                }
            }}
            alt={code}
            className={className}
            style={style}
            loading="lazy"
        />
    );
};

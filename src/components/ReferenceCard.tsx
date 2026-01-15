import type { Reference } from '../types';
import { RobustImage } from './RobustImage';

interface ReferenceCardProps {
    reference: Reference;
    onClick: (ref: Reference) => void;
    onPrint: () => void;
}

export function ReferenceCard({ reference, onClick, onPrint }: ReferenceCardProps) {
    return (
        <div
            onClick={() => onClick(reference)}
            className="group relative bg-[#1a1a1a] rounded-xl overflow-hidden border border-white/5 hover:border-blue-500/50 shadow-lg active:scale-[0.98] transition-all duration-200 cursor-pointer flex flex-col"
        >
            <div className="relative aspect-video bg-white flex items-center justify-center p-2 overflow-hidden">
                <RobustImage
                    code={reference.code}
                    className="w-full h-full object-contain"
                />

                {onPrint && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onPrint();
                        }}
                        className="absolute bottom-2 right-2 p-2 bg-blue-600/90 backdrop-blur-md text-white rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity active:scale-90 border border-white/20"
                    >
                        🖨️
                    </button>
                )}
            </div>

            <div className="p-3 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a]">
                <div className="text-[10px] text-blue-400 font-bold tracking-wider uppercase mb-0.5">{reference.category}</div>
                <div className="text-sm font-bold text-white truncate">{reference.code}</div>
            </div>
        </div>
    );
};

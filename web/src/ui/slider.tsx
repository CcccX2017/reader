import { useMemo, type ComponentProps } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

/**
 * shadcn/ui Slider.
 *
 * The same Radix slider shadcn ships. This app has no Tailwind, so the track,
 * range and thumb are drawn by `.ui-slider*` in the reader stylesheet, from the
 * same tokens as the other settings controls.
 */
export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  'aria-label': ariaLabel,
  'aria-valuetext': ariaValueText,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  const values = useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]),
    [value, defaultValue, min],
  );
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={className ? `ui-slider ${className}` : 'ui-slider'}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      {...props}
    >
      <SliderPrimitive.Track data-slot="slider-track" className="ui-slider-track">
        <SliderPrimitive.Range data-slot="slider-range" className="ui-slider-range" />
      </SliderPrimitive.Track>
      {values.map((_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="ui-slider-thumb"
          {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
          {...(ariaValueText !== undefined ? { 'aria-valuetext': ariaValueText } : {})}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

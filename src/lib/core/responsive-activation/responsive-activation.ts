/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {Subscription} from 'rxjs';
import {map} from 'rxjs/operators';

import {MediaChange, MediaQuerySubscriber} from '../media-change';
import {BreakPoint} from '../breakpoints/break-point';
import {MediaMonitor} from '../media-monitor/media-monitor';
import {extendObject} from '../../utils/object-extend';

/**
 * @deprecated
 * @deletion-target v7.0.0-beta.21
 */
export interface BreakPointX extends BreakPoint {
  key: string;
  baseKey: string;
}

/**
 * @deprecated
 * @deletion-target v7.0.0-beta.21
 */
export class KeyOptions {
  constructor(public baseKey: string,
              public defaultValue: string|number|boolean,
              public inputKeys: { [key: string]: any }) {
  }
}

/**
 * ResponsiveActivation acts as a proxy between the MonitorMedia service (which emits mediaQuery
 * changes) and the fx API directives. The MQA proxies mediaQuery change events and notifies the
 * directive via the specified callback.
 *
 * - The MQA also determines which directive property should be used to determine the
 *   current change 'value'... BEFORE the original `onMediaQueryChanges()` method is called.
 * - The `ngOnDestroy()` method is also head-hooked to enable auto-unsubscribe from the
 *   MediaQueryServices.
 *
 * NOTE: these interceptions enables the logic in the fx API directives to remain terse and clean.
 * @deprecated
 * @deletion-target v7.0.0-beta.21
 */
export class ResponsiveActivation {
  private _activatedInputKey: string = '';
  private _registryMap: BreakPointX[] = this._buildRegistryMap();
  private _subscribers: Subscription[] = this._configureChangeObservers();

  /**
   * Constructor
   */
  constructor(private _options: KeyOptions,
              private _mediaMonitor: MediaMonitor,
              private _onMediaChanges: MediaQuerySubscriber) {
  }

  /**
   * Get a readonly sorted list of the breakpoints corresponding to the directive properties
   * defined in the HTML markup: the sorting is done from largest to smallest. The order is
   * important when several media queries are 'registered' and from which, the browser uses the
   * first matching media query.
   */
  get registryFromLargest(): BreakPointX[] {
    return [...this._registryMap].reverse();
  }

  /**
   * Determine which directive @Input() property is currently active (for the viewport size):
   * The key must be defined (in use) or fallback to the 'closest' overlapping property key
   * that is defined; otherwise the default property key will be used.
   * e.g.
   *      if `<div fxHide fxHide.gt-sm="false">` is used but the current activated mediaQuery alias
   *      key is `.md` then `.gt-sm` should be used instead
   */
  get activatedInputKey(): string {
    return this._activatedInputKey || this._options.baseKey;
  }

  /**
   * Get the currently activated @Input value or the fallback default @Input value
   */
  get activatedInput(): any {
    const key = this.activatedInputKey;
    return this.hasKeyValue(key) ? this._lookupKeyValue(key) : this._options.defaultValue;
  }

  /**
   * Fast validator for presence of attribute on the host element
   */
  hasKeyValue(key: string) {
    return this._options.inputKeys[key] !== undefined;
  }

  /**
   * Remove interceptors, restore original functions, and forward the onDestroy() call
   */
  destroy() {
    this._subscribers.forEach(link => link.unsubscribe());
    this._subscribers = [];
  }

  /**
   * For each *defined* API property, register a callback to `_onMonitorEvents( )`
   * Cache 1..n subscriptions for internal auto-unsubscribes when the the directive destructs
   */
  private _configureChangeObservers(): Subscription[] {
    const subscriptions: Subscription[] = [];

    this._registryMap.forEach(bp => {
      if (this._keyInUse(bp.key)) {
        // Inject directive default property key name: to let onMediaChange() calls
        // know which property is being triggered...
        const buildChanges = (change: MediaChange) => {
          change = change.clone();
          change.property = this._options.baseKey;
          return change;
        };

        subscriptions.push(
          this._mediaMonitor
              .observe(bp.alias)
              .pipe(map(buildChanges))
              .subscribe(change => {
                this._onMonitorEvents(change);
              })
        );
      }
    });

    return subscriptions;
  }

  /**
   * Build mediaQuery key-hashmap; only for the directive properties that are actually defined/used
   * in the HTML markup
   */
  private _buildRegistryMap() {
    return this._mediaMonitor.breakpoints
      .map(bp => <BreakPointX>extendObject({}, bp, {
        baseKey: this._options.baseKey,         // e.g. layout, hide, self-align, flex-wrap
        key: this._options.baseKey + bp.suffix  // e.g. layoutGtSm, layoutMd, layoutGtLg
      }))
      .filter(bp => this._keyInUse(bp.key));
  }

  /**
   * Synchronizes change notifications with the current mq-activated @Input and calculates the
   * mq-activated input value or the default value
   */
  protected _onMonitorEvents(change: MediaChange) {
    if (change.property === this._options.baseKey) {
      change.value = this._calculateActivatedValue(change);
      this._onMediaChanges(change);
    }
  }

  /**
   * Has the key been specified in the HTML markup and thus is intended
   * to participate in activation processes.
   */
  private _keyInUse(key: string): boolean {
    return this._lookupKeyValue(key) !== undefined;
  }

  /**
   *  Map input key associated with mediaQuery activation to closest defined input key
   *  then return the values associated with the targeted input property
   *
   *  !! change events may arrive out-of-order (activate before deactivate)
   *     so make sure the deactivate is used ONLY when the keys match
   *     (since a different activate may be in use)
   */
  private _calculateActivatedValue(current: MediaChange): any {
    const currentKey = this._options.baseKey + current.suffix;  // e.g. suffix == 'GtSm',
    let newKey = this._activatedInputKey;                       // e.g. newKey == hideGtSm

    newKey = current.matches ? currentKey : ((newKey === currentKey) ? '' : newKey);

    this._activatedInputKey = this._validateInputKey(newKey);
    return this.activatedInput;
  }

  /**
   * For the specified input property key, validate it is defined (used in the markup)
   * If not see if a overlapping mediaQuery-related input key fallback has been defined
   *
   * NOTE: scans in the order defined by activeOverLaps (largest viewport ranges -> smallest ranges)
   */
  private _validateInputKey(inputKey: string) {
    const isMissingKey = (key: string) => !this._keyInUse(key);

    if (isMissingKey(inputKey)) {
      this._mediaMonitor.activeOverlaps.some(bp => {
        const key = this._options.baseKey + bp.suffix;
        if (!isMissingKey(key)) {
          inputKey = key;
          return true;  // exit .some()
        }
        return false;
      });
    }
    return inputKey;
  }

  /**
   * Get the value (if any) for the directive instances @Input property (aka key)
   */
  private _lookupKeyValue(key: string) {
    return this._options.inputKeys[key];
  }

}

package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.ui.theme.dsh
import android.provider.Settings
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset

private val Ease = FastOutSlowInEasing

@Composable
fun reduceMotion(): Boolean {
    val context = LocalContext.current
    val scale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    return scale == 0f
}

@Composable
fun dshClickable(enabled: Boolean = true, ripple: Boolean = true, onClick: () -> Unit): Modifier {
    val p = dsh()
    val source = remember { MutableInteractionSource() }
    return Modifier.clickable(
        enabled = enabled,
        interactionSource = source,
        indication = if (ripple) ripple(bounded = true, color = p.interactiveHover) else null,
        onClick = onClick,
    )
}

@Composable
fun overlayEnter(): EnterTransition {
    val d = if (reduceMotion()) 0 else 200
    return fadeIn(tween(d, easing = Ease)) +
        scaleIn(tween(d, easing = Ease), initialScale = 0.96f) +
        slideInVertically(tween(d, easing = Ease)) { 8 }
}

@Composable
fun overlayExit(): ExitTransition {
    val d = if (reduceMotion()) 0 else 100
    return fadeOut(tween(d, easing = Ease)) +
        scaleOut(tween(d, easing = Ease), targetScale = 0.96f) +
        slideOutVertically(tween(d, easing = Ease)) { 8 }
}

@Composable
fun popoverEnter(): EnterTransition {
    val d = if (reduceMotion()) 0 else 160
    return fadeIn(tween(d, easing = Ease)) + slideInVertically(tween(d, easing = Ease)) { 4 }
}

@Composable
fun popoverExit(): ExitTransition {
    val d = if (reduceMotion()) 0 else 100
    return fadeOut(tween(d, easing = Ease))
}

@Composable
fun maskEnter(): EnterTransition {
    val d = if (reduceMotion()) 0 else 200
    return fadeIn(tween(d, easing = Ease))
}

@Composable
fun maskExit(): ExitTransition {
    val d = if (reduceMotion()) 0 else 100
    return fadeOut(tween(d, easing = Ease))
}

@Composable
fun drawerEnter(): EnterTransition {
    val d = if (reduceMotion()) 0 else 300
    return slideInHorizontally(tween(d, easing = Ease)) { -it }
}

@Composable
fun drawerExit(): ExitTransition {
    val d = if (reduceMotion()) 0 else 300
    return slideOutHorizontally(tween(d, easing = Ease)) { -it }
}

fun maskTween(reduce: Boolean) = tween<Float>(if (reduce) 0 else 200, easing = Ease)
fun offsetTween(reduce: Boolean, ms: Int) = tween<IntOffset>(if (reduce) 0 else ms, easing = Ease)

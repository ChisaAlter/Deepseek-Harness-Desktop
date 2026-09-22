package ai.deepseek.harness.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

val LocalDshPalette = staticCompositionLocalOf { DshTokens.Light }

@Composable
fun DshTheme(dark: Boolean, content: @Composable () -> Unit) {
    val palette = if (dark) DshTokens.Dark else DshTokens.Light
    val scheme = if (dark) {
        darkColorScheme(
            primary = palette.buttonPrimaryFill,
            onPrimary = palette.labelPrimaryForeground,
            secondary = palette.buttonInfoFill,
            background = palette.bgBase,
            surface = palette.bgLayer1,
            onBackground = palette.labelPrimary,
            onSurface = palette.labelPrimary,
            error = palette.error,
            outline = palette.borderL2,
        )
    } else {
        lightColorScheme(
            primary = palette.buttonPrimaryFill,
            onPrimary = palette.labelPrimaryForeground,
            secondary = palette.buttonInfoFill,
            background = palette.bgBase,
            surface = palette.bgLayer1,
            onBackground = palette.labelPrimary,
            onSurface = palette.labelPrimary,
            error = palette.error,
            outline = palette.borderL2,
        )
    }
    CompositionLocalProvider(LocalDshPalette provides palette) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}

@Composable
fun dsh(): DshPalette = LocalDshPalette.current

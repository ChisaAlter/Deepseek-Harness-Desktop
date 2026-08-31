package ai.deepseek.harness.mobile.ui

import ai.deepseek.harness.mobile.DshViewModel
import ai.deepseek.harness.mobile.Route
import ai.deepseek.harness.mobile.ui.theme.dsh
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Capsule = RoundedCornerShape(18.dp)
private val FieldShape = RoundedCornerShape(8.dp)

@Composable
fun DshRoot(vm: DshViewModel, onRequestScan: () -> Unit, onOpenAppSettings: () -> Unit) {
    val palette = dsh()
    Box(Modifier.fillMaxSize().background(palette.bgBase)) {
        when (vm.route) {
            Route.Connect -> ConnectScreen(vm, onRequestScan)
            Route.Permission -> PermissionScreen(vm, onOpenAppSettings)
            Route.Scan, Route.Web -> Unit
        }
    }
}

@Composable
private fun ConnectScreen(vm: DshViewModel, onRequestScan: () -> Unit) {
    val palette = dsh()
    Column(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("手机远程", color = palette.labelTertiary, fontSize = 13.sp, lineHeight = 20.sp)
        Spacer(Modifier.height(8.dp))
        Text(
            "连接到这台电脑",
            color = palette.labelPrimary,
            fontSize = 16.sp,
            lineHeight = 24.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "扫描桌面侧栏远程弹窗里的二维码。应用会在内部打开桌面提供的手机页，配对、重连与消息都走 dshd 远程。",
            color = palette.labelSecondary,
            fontSize = 14.sp,
            lineHeight = 22.sp,
        )
        if (vm.error.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Text(vm.error, color = palette.error, fontSize = 12.sp, lineHeight = 18.sp)
        }
        Spacer(Modifier.height(16.dp))
        DshButton("扫描二维码", primary = true, onClick = onRequestScan)
        if (vm.hasRememberedWebApp) {
            Spacer(Modifier.height(12.dp))
            DshButton("打开已配对的手机页", onClick = vm::reopenWebApp)
        }
        Spacer(Modifier.height(12.dp))
        DshField(
            value = vm.paste,
            onValueChange = { vm.paste = it },
            placeholder = "http://192.168.1.23:3180/#offer=…",
        )
        Spacer(Modifier.height(12.dp))
        DshButton("用完整链接连接", onClick = vm::connectFromPaste)
    }
}

@Composable
private fun PermissionScreen(vm: DshViewModel, onOpenAppSettings: () -> Unit) {
    val palette = dsh()
    Column(
        Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Text(
            "需要相机权限",
            color = palette.labelPrimary,
            fontSize = 16.sp,
            lineHeight = 24.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            "扫码要用相机。拒绝后仍可粘贴桌面复制的完整配对链接。",
            color = palette.labelSecondary,
            fontSize = 14.sp,
            lineHeight = 22.sp,
        )
        DshButton("去系统设置", primary = true, onClick = onOpenAppSettings)
        DshButton("改用粘贴链接", onClick = { vm.route = Route.Connect })
    }
}

@Composable
private fun DshButton(
    label: String,
    primary: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = dsh()
    Box(
        Modifier
            .fillMaxWidth()
            .height(36.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .clip(Capsule)
            .background(if (primary) palette.buttonPrimaryFill else palette.bgLayer1)
            .border(1.dp, if (primary) palette.buttonPrimaryFill else palette.borderL2, Capsule)
            .then(dshClickable(enabled = enabled, onClick = onClick))
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (primary) palette.labelPrimaryForeground else palette.labelPrimary,
            fontSize = 14.sp,
            lineHeight = 22.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun DshField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
) {
    val palette = dsh()
    Box(
        Modifier
            .fillMaxWidth()
            .height(36.dp)
            .clip(FieldShape)
            .border(1.dp, palette.borderL2, FieldShape)
            .background(palette.bgLayer1)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (value.isEmpty()) {
            Text(placeholder, color = palette.labelCaption, fontSize = 14.sp, lineHeight = 22.sp)
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(
                color = palette.labelPrimary,
                fontSize = 14.sp,
                lineHeight = 22.sp,
            ),
            cursorBrush = SolidColor(palette.labelPrimary),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

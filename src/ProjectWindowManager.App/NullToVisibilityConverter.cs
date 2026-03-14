using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace ProjectWindowManager.App
{
    public class NullToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            bool isNull = value == null;
            bool inverse = parameter as string == "Inverse";

            if (inverse)
            {
                return isNull ? Visibility.Collapsed : Visibility.Visible;
            }
            return isNull ? Visibility.Visible : Visibility.Collapsed;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
